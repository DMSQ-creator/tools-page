#!/usr/bin/env python3
"""Update the static catalog from official sources using only Python's standard library.

python scripts/update_data.py                 # fetch; validate before replacing files
python scripts/update_data.py --offline       # reproduce from the checked-in raw inputs
python scripts/update_data.py --start-year 2020 --end-year 2025
See scripts/DATA.md for coverage, caveats and the meaning of dates.
"""
from __future__ import annotations
import argparse
from collections import Counter
from datetime import datetime, timezone
import hashlib
import html
import json
import math
from pathlib import Path
import re
import sys
import tempfile
import time
import urllib.request

ROOT = Path(__file__).resolve().parents[1]
INDICATOR = 'NY.GDP.PCAP.CD'
ITU_URL = 'https://www.itu.int/oth/T0202.aspx?lang=en&parent=T0202'
WB_COUNTRIES_URL = 'https://api.worldbank.org/v2/country?format=json&per_page=400'
MIN_COVERAGE = 0.90


def fetch(url, attempts=3, timeout=30):
    """Bounded retries; never turn a network failure into empty output."""
    error = None
    for attempt in range(attempts):
        try:
            request = urllib.request.Request(url, headers={'User-Agent': 'tools-page-data-updater/1.0'})
            with urllib.request.urlopen(request, timeout=timeout) as response:
                return response.read()
        except (OSError, ValueError) as exc:
            error = exc
            if attempt + 1 < attempts:
                time.sleep(attempt + 1)
    raise RuntimeError(f'Unable to download {url} after {attempts} attempts: {error}')


def decode_wb(raw):
    payload = json.loads(raw)
    if not isinstance(payload, list) or len(payload) != 2 or not isinstance(payload[1], list):
        raise ValueError('Unexpected World Bank response')
    meta, rows = payload
    if int(meta.get('pages', 0)) != 1 or int(meta.get('total', -1)) != len(rows):
        raise ValueError('Incomplete World Bank pagination; increase per_page or implement pagination')
    if not rows:
        raise ValueError('Empty World Bank response')
    return meta, rows


def parse_itu(raw):
    """Read option text, not scripts; keyed by ITU document IDs, never fuzzy names."""
    text = raw.decode('utf-8-sig')
    options = re.findall(r'<option value="(T0202\w+)">([\d ]+) \((.*?)\)</option>', text)
    result = {}
    for key, prefix, name in options:
        result.setdefault(key, {'name': html.unescape(name), 'prefixes': []})['prefixes'].append('+' + prefix.replace(' ', ''))
    if len(result) < 220:
        raise ValueError('Incomplete or changed ITU listing')
    return result


def build_phone(seed, mapping, raw, updated_at):
    itu = parse_itu(raw)
    records = []
    unconfirmed = {'UM', 'BV', 'AQ', 'HM', 'TF', 'GS'}
    split_prefix = {'AX': '+358', 'SJ': '+47', 'VA': '+39', 'EH': '+212'}
    for source in seed:
        record = {k: source[k] for k in ('zh', 'en', 'i2', 'i3', 'f')}
        i2 = source['i2']
        if i2 in mapping:
            if mapping[i2] not in itu:
                raise ValueError(f'Missing ITU document {mapping[i2]} for {i2}')
            prefixes = itu[mapping[i2]]['prefixes']
            country_codes = {'+1' if p.startswith('+1') else p for p in prefixes}
            if len(country_codes) != 1:
                raise ValueError(f'Unreviewed multi-country-code record: {i2}')
            record.update(callingCode=country_codes.pop(), prefixes=prefixes)
            if record['callingCode'] == '+1':
                record['note'] = '北美编号计划共享国家码 +1；所列地区前缀不是独立国家码。' if prefixes != ['+1'] else '北美编号计划共享国家码 +1；不枚举国内区号。'
            if i2 == 'SH':
                record.update(callingCode=None, prefixes=prefixes + itu['T020200000C']['prefixes'], note='该 ISO 地区不对应单一国家码：圣赫勒拿及特里斯坦-达库尼亚 +290；阿森松 +247。')
        elif i2 in unconfirmed:
            record.update(callingCode=None, prefixes=[], note='未确认统一、可普遍使用的地区呼叫码；不以所属国号码或旧表推断。具体站点可能使用卫星或其他网络。')
        else:
            code = split_prefix.get(i2, source['code'])
            record.update(callingCode=code, prefixes=[source['code']], note='共享或特殊地区编号：沿用旧表并区分国家码/地区前缀；本轮未逐项核验当地官方编号计划，不保证覆盖所有业务。')
        if i2 == 'XK':
            record['note'] = 'XK / XKX 为实用代码（XKX 同世界银行），不是正式分配的 ISO 3166-1 代码。'
        records.append(record)
    return {'updatedAt': updated_at, 'sources': [
        {'name': 'ITU National Numbering Plans（列表核对；不等于全部国内编号计划已核验）', 'url': ITU_URL},
        {'name': '原项目中文名称及未全面核验的共享地区资料（历史快照）', 'url': 'https://github.com/DMSQ-creator/tools-page/blob/12e598c29471a5ae91fbfe4437fbc956e4c8d21a/index.html'}
    ], 'records': records}


def choose_default_year(counts, population, threshold=MIN_COVERAGE):
    acceptable = [year for year, count in counts.items() if count / population >= threshold]
    if not acceptable:
        raise ValueError(f'No year reaches {threshold:.0%} economy coverage; preserve old snapshot')
    return max(acceptable)


def build_gdp(seed, countries_raw, gdp_raw, updated_at, expected_years=None):
    _, all_countries = decode_wb(countries_raw)
    meta, observations = decode_wb(gdp_raw)
    countries = {r['id']: r for r in all_countries if r['region']['id'] != 'NA'}
    if len(countries) < 200:
        raise ValueError('Too few non-aggregate World Bank economies')
    names = {r['i3']: r for r in seed}
    # This is a World Bank economy grouping, not an ISO country; no invented flag.
    names['CHI'] = dict(zh='海峡群岛', en='Channel Islands', i2='JG', i3='CHI', f='')
    records = {}
    for code, country in sorted(countries.items()):
        if code not in names:
            raise ValueError(f'Unmapped World Bank code {code}; review country-seed.json')
        records[code] = {k: names[code][k] for k in ('zh', 'en', 'i2', 'i3', 'f')}
        records[code].update(wbCode=code, values={})
        if code == 'CHI':
            records[code]['note'] = 'JG / CHI 为世界银行代码，非 ISO；海峡群岛为该机构经济体分组。'
        elif code == 'XKX':
            records[code]['note'] = 'XK / XKX 为实用代码（XKX 同世界银行），不是正式分配的 ISO 3166-1 代码。'
    counts = Counter()
    seen = set()
    for row in observations:
        code, year, value = row['countryiso3code'], row['date'], row['value']
        if code not in countries:
            continue
        if row['indicator']['id'] != INDICATOR or not re.fullmatch(r'\d{4}', year):
            raise ValueError('Unexpected indicator or observation year')
        if (code, year) in seen:
            raise ValueError(f'Duplicate observation: {code}/{year}')
        seen.add((code, year))
        if value is None:
            continue
        if isinstance(value, bool) or not isinstance(value, (int, float)) or not math.isfinite(value) or value < 0:
            raise ValueError(f'Invalid GDP value for {code}/{year}')
        records[code]['values'][year] = value
        counts[int(year)] += 1
    years = set(expected_years) if expected_years is not None else {int(row['date']) for row in observations}
    expected = {(code, str(year)) for code in countries for year in years}
    if seen != expected:
        raise ValueError(f'Incomplete economy/year matrix: missing {len(expected - seen)}, unexpected {len(seen - expected)}')
    result = {'updatedAt': updated_at, 'source': {'name': 'World Bank · World Development Indicators · GDP per capita (current US$)', 'url': f'https://data.worldbank.org/indicator/{INDICATOR}', 'indicator': INDICATOR}, 'defaultYear': choose_default_year(counts, len(countries)), 'years': sorted(counts, reverse=True), 'records': list(records.values())}
    if meta.get('lastupdated'):
        result['sourceUpdatedAt'] = meta['lastupdated']
    return result


def validate(catalog):
    if catalog['schemaVersion'] != 1:
        raise ValueError('Unsupported schema')
    for section in ('phone', 'gdp'):
        records = catalog[section]['records']
        if len({r['i2'] for r in records}) != len(records) or len({r['i3'] for r in records}) != len(records):
            raise ValueError(f'Duplicate {section} country code')
        for r in records:
            if not r['zh'] or not r['en'] or not re.fullmatch('[A-Z]{2}', r['i2']) or not re.fullmatch('[A-Z]{3}', r['i3']):
                raise ValueError('Invalid country metadata')
    for r in catalog['phone']['records']:
        if r['callingCode'] is not None and not re.fullmatch(r'\+[1-9]\d{0,2}', r['callingCode']):
            raise ValueError(f'Invalid E.164 country code: {r}')
        for prefix in r['prefixes']:
            if not re.fullmatch(r'\+[1-9]\d*', prefix) or (r['callingCode'] and not prefix.startswith(r['callingCode'])):
                raise ValueError(f'Invalid prefix: {r}')
    if catalog['gdp']['defaultYear'] not in catalog['gdp']['years']:
        raise ValueError('Default year missing')


def publish(files):
    """Stage every byte before publishing; restore old bytes if replacement fails."""
    staged = []
    previous = {path: path.read_bytes() if path.exists() else None for path in files}
    replaced = []
    try:
        for path, content in files.items():
            path.parent.mkdir(parents=True, exist_ok=True)
            with tempfile.NamedTemporaryFile(dir=path.parent, delete=False, suffix='.tmp') as tmp:
                tmp.write(content)
                staged.append((Path(tmp.name), path))
        for tmp, path in staged:
            tmp.replace(path)
            replaced.append(path)
    except Exception:
        for path in reversed(replaced):
            if previous[path] is None:
                path.unlink(missing_ok=True)
            else:
                path.write_bytes(previous[path])
        raise
    finally:
        for tmp, _ in staged:
            tmp.unlink(missing_ok=True)


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--offline', action='store_true')
    parser.add_argument('--start-year', type=int)
    parser.add_argument('--end-year', type=int)
    parser.add_argument('--data-dir', type=Path, default=ROOT / 'data')
    args = parser.parse_args(argv)
    directory = args.data_dir
    seed = json.loads((ROOT/'scripts/country-seed.json').read_text(encoding='utf-8'))
    mapping = json.loads((ROOT/'scripts/itu-map.json').read_text(encoding='utf-8'))
    if args.offline:
        manifest = json.loads((directory/'raw/manifest.json').read_text(encoding='utf-8'))
        raws = {name: (directory/'raw'/name).read_bytes() for name in ('wb-countries.json', 'wb-gdp.json', 'itu.html')}
        for name, content in raws.items():
            if hashlib.sha256(content).hexdigest() != manifest['files'][name]['sha256']:
                raise ValueError(f'Raw source checksum mismatch: {name}')
    else:
        end = args.end_year if args.end_year is not None else datetime.now(timezone.utc).year - 1
        start = args.start_year if args.start_year is not None else end - 5
        if start > end or not 1960 <= start <= end <= datetime.now(timezone.utc).year:
            raise ValueError('Invalid year range')
        urls = {'wb-countries.json': WB_COUNTRIES_URL, 'wb-gdp.json': f'https://api.worldbank.org/v2/country/all/indicator/{INDICATOR}?format=json&date={start}:{end}&per_page=20000', 'itu.html': ITU_URL}
        raws = {name: fetch(url) for name, url in urls.items()}
        manifest = {'retrievedAt': datetime.now(timezone.utc).isoformat(timespec='seconds'), 'files': {name: {'url': urls[name], 'sha256': hashlib.sha256(content).hexdigest()} for name, content in raws.items()}}
    updated_at = manifest['retrievedAt'][:10]
    requested_range = re.search(r'[?&]date=(\d{4}):(\d{4})(?:&|$)', manifest['files']['wb-gdp.json']['url'])
    if not requested_range:
        raise ValueError('Missing requested year range in source manifest')
    first, last = map(int, requested_range.groups())
    expected_years = range(first, last + 1)
    catalog = {'schemaVersion': 1, 'phone': build_phone(seed, mapping, raws['itu.html'], updated_at), 'gdp': build_gdp(seed, raws['wb-countries.json'], raws['wb-gdp.json'], updated_at, expected_years)}
    validate(catalog)
    serialized = json.dumps(catalog, ensure_ascii=False, indent=2, allow_nan=False)
    files = {directory/'catalog.json': (serialized+'\n').encode(), directory/'catalog.js': ('window.TOOLS_DATA = '+serialized+';\n').encode()}
    if not args.offline:
        files.update({directory/'raw'/name: raw for name, raw in raws.items()})
        files[directory/'raw/manifest.json'] = (json.dumps(manifest, ensure_ascii=False, indent=2)+'\n').encode()
    publish(files)
    counts = {year: sum(str(year) in r['values'] for r in catalog['gdp']['records']) for year in catalog['gdp']['years']}
    print(json.dumps({'phoneRecords': len(catalog['phone']['records']), 'gdpEconomies': len(catalog['gdp']['records']), 'yearCoverage': counts, 'defaultYear': catalog['gdp']['defaultYear'], 'sourceUpdatedAt': catalog['gdp'].get('sourceUpdatedAt')}, ensure_ascii=True))
    return 0


if __name__ == '__main__':
    try:
        sys.exit(main())
    except (OSError, ValueError, KeyError, RuntimeError) as exc:
        print(f'Update failed; existing snapshot retained: {exc}', file=sys.stderr)
        sys.exit(1)
