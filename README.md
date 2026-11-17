# 在线查询工具箱

国家/地区呼叫码、人均 GDP 查询及第三方 IP 风控入口。保留静态站点，不需要后端或构建流程。

## 预览与部署

直接打开 [首页](<index.html>) 即可查询本地快照；原有 Tailwind CDN、Google Fonts 和第三方 IP 页面仍需联网。没有另起服务或改变现有域名。

部署到 GitHub Pages 时，必须一起上传 [首页](<index.html>)、[交互脚本](<app.js>) 和 [浏览器数据快照](<data/catalog.js>)，保持相对路径不变，并保留现有 [域名配置](<CNAME>)。仅修改本地不会更新线上；审核改动后提交、推送，由仓库 GitHub Pages 配置部署。数据更新脚本不配置定时任务，也不会自行提交或推送。

## 本次数据维护

来源与更新时间统一放在页脚，查询区只保留简短口径提示、筛选和结果。

- 电话资料 250 条；230 条映射 ITU 当前列表。修正美国、俄罗斯、哈萨克斯坦的国家呼叫码，补齐多米尼加共和国、波多黎各、牙买加的多前缀。
- 区分国家呼叫码与地区拨号前缀。未确认的特殊地区留空；14 条历史共享地区资料明确显示未逐项核验备注，不能视为全量官方核验。
- 世界银行 `NY.GDP.PCAP.CD`：现价美元人均 GDP，非 PPP。当前快照覆盖 2020–2025，源更新日期为 2026-11-11。
- 排除区域/收入组等汇总项，收录 217 个经济体；按稳定代码匹配名称，修复简码和旗帜缺失，保留非 ISO 代码说明。
- 默认 **2024 年同年排名**（200 个经济体有值）。2025 年有值 186 个，仍可选择。默认年取覆盖全体经济体至少 90% 的最新年份，不盲目追最新年份。
- “各地最新可用值”显示每条实际年份，仅排序、不显示同年排名；此处最新指本快照六年范围内的最新值，不代表更早的历史值。
- 同年排名在搜索前计算，搜索不会把任意国家变成第 1；精确简码搜索优先于名称子串。缺失不填 0、不跨年补齐。显示金额四舍五入至美元，排名按原始精度。

## 更新数据

Python 3.10+，只用标准库，不需要安装依赖。在仓库根目录执行：

```sh
python scripts/update_data.py
python -m unittest discover -s tests -p test_data.py -v
node --test tests/app.test.cjs
```

更新脚本获取最近六个完整日历年，保存原始响应和 SHA-256，验证后同时生成 [JSON 快照](<data/catalog.json>) 和 [JS 快照](<data/catalog.js>)。请求/解析/完整性检查失败时保留旧快照，不用空数据覆盖。更新完成后先查看差异，再提交发布。

指定年份或不联网重现：

```sh
python scripts/update_data.py --start-year 2020 --end-year 2025
python scripts/update_data.py --offline
```

详细规则、原始数据来源与核验边界见 [数据维护说明](<scripts/DATA.md>)；不要直接手改生成快照，名称映射修改 [名称表](<scripts/country-seed.json>)，ITU 对应关系修改 [号码计划映射](<scripts/itu-map.json>) 后重建并测试。

## 测试

Node.js 22+；不需要 npm install：

```sh
node --test tests/app.test.cjs
python -m unittest discover -s tests -p test_data.py -v
```

可选真实浏览器测试：

```sh
node tests/browser-smoke.cjs
```

默认使用 Windows 已安装的 Edge；其他位置可设置 `BROWSER_PATH` 为 Chromium/Edge 可执行文件。测试使用独立临时配置，直接打开本地首页，不启动网站服务器、不复用个人浏览器资料；检查搜索、年份、排名、主题、320/390px 手机宽度和未捕获异常。产物放在被 Git 忽略的 `.browser-test/` 目录。不会测试第三方 IP 服务的数据准确性。

## 来源及限制

GDP 来自 [World Bank WDI](<https://data.worldbank.org/indicator/NY.GDP.PCAP.CD>)（[CC BY 4.0](<https://creativecommons.org/licenses/by/4.0/>)），电话主来源为 [ITU National Numbering Plans](<https://www.itu.int/oth/T0202.aspx?lang=en&parent=T0202>)。中文名称及未全面核验的共享地区资料继承原项目；每条特殊备注与 [维护说明](<scripts/DATA.md>) 为准。数据快照获取日期与数据源更新时间分开显示，均不等同于每一条记录的官方核验日期。
