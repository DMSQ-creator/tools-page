"""Offline tests: python -m unittest discover -s tests -p test_data.py -v"""
import copy
import importlib.util
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location('update_data', ROOT/'scripts/update_data.py')
updater = importlib.util.module_from_spec(spec)
spec.loader.exec_module(updater)


class CatalogTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.catalog = json.loads((ROOT/'data/catalog.json').read_text(encoding='utf-8'))
        cls.seed = json.loads((ROOT/'scripts/country-seed.json').read_text(encoding='utf-8'))
        cls.countries = (ROOT/'data/raw/wb-countries.json').read_bytes()
        cls.gdp = (ROOT/'data/raw/wb-gdp.json').read_bytes()

    def test_schema_and_unique_codes(self):
        updater.validate(self.catalog)
        self.assertEqual(set(self.catalog), {'schemaVersion', 'phone', 'gdp'})
        self.assertEqual(len(self.catalog['phone']['records']), 250)
        for record in self.catalog['phone']['records']:
            self.assertLessEqual(set(record), {'zh', 'en', 'i2', 'i3', 'f', 'callingCode', 'prefixes', 'note'})
        for record in self.catalog['gdp']['records']:
            self.assertEqual(set(record) - {'note'}, {'zh', 'en', 'i2', 'i3', 'f', 'wbCode', 'values'})

    def test_static_javascript_matches_json_exactly(self):
        js = (ROOT/'data/catalog.js').read_text(encoding='utf-8')
        self.assertTrue(js.startswith('window.TOOLS_DATA = '))
        self.assertEqual(json.loads(js[len('window.TOOLS_DATA = '):].rstrip().removesuffix(';')), self.catalog)

    def test_country_codes_and_multiple_prefixes(self):
        records = {r['i2']: r for r in self.catalog['phone']['records']}
        for code, calling in [('US', '+1'), ('RU', '+7'), ('KZ', '+7')]:
            self.assertEqual(records[code]['callingCode'], calling)
            self.assertEqual(records[code]['prefixes'], [calling])
        for code, prefixes in [('DO', ['+1809', '+1829', '+1849']), ('PR', ['+1787', '+1939']), ('JM', ['+1876', '+1658'])]:
            self.assertEqual(records[code]['callingCode'], '+1')
            self.assertEqual(records[code]['prefixes'], prefixes)
        for code in ('UM', 'BV', 'AQ', 'HM', 'TF', 'GS'):
            self.assertIsNone(records[code]['callingCode'])
            self.assertEqual(records[code]['prefixes'], [])
        self.assertIsNone(records['SH']['callingCode'])
        self.assertEqual(records['SH']['prefixes'], ['+290', '+247'])
        self.assertEqual(records['DM']['zh'], '多米尼克')

    def test_no_aggregates_and_exact_observations(self):
        countries = json.loads(self.countries)[1]
        economies = {r['id'] for r in countries if r['region']['id'] != 'NA'}
        aggregates = {r['id'] for r in countries if r['region']['id'] == 'NA'}
        records = {r['wbCode']: r for r in self.catalog['gdp']['records']}
        self.assertEqual(set(records), economies)
        self.assertFalse(set(records) & aggregates)
        observed = json.loads(self.gdp)[1]
        for row in observed:
            if row['countryiso3code'] not in records:
                continue
            values = records[row['countryiso3code']]['values']
            if row['value'] is None:
                self.assertNotIn(row['date'], values)
            else:
                self.assertEqual(values[row['date']], row['value'])
        self.assertEqual(records['XKX']['i2'], 'XK')
        self.assertEqual(records['CHI']['zh'], '海峡群岛')

    def test_default_year_uses_90_percent_coverage(self):
        gdp = self.catalog['gdp']
        counts = {y: sum(str(y) in r['values'] for r in gdp['records']) for y in gdp['years']}
        self.assertEqual(gdp['defaultYear'], updater.choose_default_year(counts, len(gdp['records'])))
        self.assertEqual(updater.choose_default_year({2024: 95, 2025: 89}, 100), 2024)
        with self.assertRaises(ValueError):
            updater.choose_default_year({2024: 89}, 100)

    def test_missing_is_not_zero_and_zero_is_retained(self):
        raw = json.loads(self.gdp)
        for row in raw[1]:
            if row['countryiso3code'] == 'USA':
                row['value'] = 0 if row['date'] == '2024' else None
        result = updater.build_gdp(self.seed, self.countries, json.dumps(raw).encode(), '2026-11-17')
        us = next(r for r in result['records'] if r['wbCode'] == 'USA')
        self.assertEqual(us['values'], {'2024': 0})

    def test_partial_or_invalid_source_rejected(self):
        raw = json.loads(self.gdp)
        raw[0]['pages'] = 2
        with self.assertRaises(ValueError):
            updater.decode_wb(json.dumps(raw))
        with self.assertRaises(ValueError):
            updater.parse_itu(b'<html>unavailable</html>')
        raw = json.loads(self.gdp)
        row = next(r for r in raw[1] if r['countryiso3code'] == 'USA')
        row['value'] = -1
        with self.assertRaises(ValueError):
            updater.build_gdp(self.seed, self.countries, json.dumps(raw), '2026-11-17')

    def test_missing_year_and_missing_economy_cell_rejected(self):
        for mode in ('year', 'cell'):
            raw = json.loads(self.gdp)
            raw[1] = [r for r in raw[1] if not (r['date'] == '2024' and (mode == 'year' or r['countryiso3code'] == 'USA'))]
            raw[0]['total'] = len(raw[1])
            with self.assertRaises(ValueError):
                updater.build_gdp(self.seed, self.countries, json.dumps(raw), '2026-11-17', range(2020, 2026))

    def test_retry_is_bounded(self):
        with patch.object(updater.urllib.request, 'urlopen', side_effect=OSError('offline')) as request, patch.object(updater.time, 'sleep'):
            with self.assertRaises(RuntimeError):
                updater.fetch('https://example.invalid', attempts=2, timeout=1)
        self.assertEqual(request.call_count, 2)

    def test_network_failure_preserves_existing_snapshot(self):
        with tempfile.TemporaryDirectory() as tmp:
            directory = Path(tmp)
            (directory/'catalog.json').write_bytes(b'old-json')
            (directory/'catalog.js').write_bytes(b'old-js')
            with patch.object(updater, 'fetch', side_effect=RuntimeError('offline')):
                with self.assertRaises(RuntimeError):
                    updater.main(['--data-dir', str(directory)])
            self.assertEqual((directory/'catalog.json').read_bytes(), b'old-json')
            self.assertEqual((directory/'catalog.js').read_bytes(), b'old-js')

    def test_offline_rebuild_is_byte_identical(self):
        with tempfile.TemporaryDirectory() as tmp:
            directory = Path(tmp)
            (directory/'raw').mkdir()
            for name in ('wb-countries.json', 'wb-gdp.json', 'itu.html', 'manifest.json'):
                (directory/'raw'/name).write_bytes((ROOT/'data/raw'/name).read_bytes())
            updater.main(['--offline', '--data-dir', str(directory)])
            for name in ('catalog.json', 'catalog.js'):
                self.assertEqual((directory/name).read_bytes(), (ROOT/'data'/name).read_bytes())

    def test_bad_checksum_preserves_snapshot(self):
        with tempfile.TemporaryDirectory() as tmp:
            directory = Path(tmp)
            (directory/'raw').mkdir()
            for name in ('wb-countries.json', 'wb-gdp.json', 'itu.html', 'manifest.json'):
                (directory/'raw'/name).write_bytes((ROOT/'data/raw'/name).read_bytes())
            (directory/'raw/itu.html').write_bytes(b'corrupted')
            (directory/'catalog.json').write_bytes(b'old')
            with self.assertRaises(ValueError):
                updater.main(['--offline', '--data-dir', str(directory)])
            self.assertEqual((directory/'catalog.json').read_bytes(), b'old')

    def test_publish_rolls_back_on_replace_failure(self):
        with tempfile.TemporaryDirectory() as tmp:
            a, b = Path(tmp)/'a', Path(tmp)/'b'
            a.write_bytes(b'old-a')
            b.write_bytes(b'old-b')
            original = Path.replace
            def replace(path, target):
                if target == b:
                    raise OSError('simulated failed replacement')
                return original(path, target)
            with patch.object(Path, 'replace', replace):
                with self.assertRaises(OSError):
                    updater.publish({a: b'new-a', b: b'new-b'})
            self.assertEqual(a.read_bytes(), b'old-a')
            self.assertEqual(b.read_bytes(), b'old-b')
            self.assertEqual(sorted(p.name for p in Path(tmp).iterdir()), ['a', 'b'])


if __name__ == '__main__':
    unittest.main()
