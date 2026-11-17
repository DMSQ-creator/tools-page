# 数据维护与已知边界

## 使用

仅需 Python 3.10+ 标准库，无 pip 依赖。在仓库根目录运行：

```sh
python scripts/update_data.py
python scripts/update_data.py --start-year 2020 --end-year 2025
python scripts/update_data.py --offline
python -m unittest discover -s tests -p test_data.py -v
```

在线模式默认请求当前 UTC 年之前的最近 6 个完整日历年。每个请求超时 30 秒，最多尝试 3 次，间隔 1、2 秒；源请求全部成功、解析与校验全部通过之后，才发布快照。新增未知经济体、分页截断、请求年份×非汇总经济体矩阵不完整、覆盖率不足、ITU 页面结构异常等都会中止，保留旧快照。所有输出先写临时文件，替换失败时回滚旧内容（但无法承诺操作系统崩溃时的跨文件事务）。`--data-dir PATH` 可输出到其他目录。

[原始响应和哈希清单](../data/raw/manifest.json) 与生成结果一同保存。离线模式先核对 SHA-256，再从原始响应重建；不会访问网络，也不会改变抓取日期。测试验证离线输出与已提交的 [JSON](../data/catalog.json)、[JS](../data/catalog.js) **逐字节相同**，JS 仅为 `window.TOOLS_DATA = <同一 JSON>;`。页面可用普通 script 标签加载，不依赖 fetch、构建工具或运行时 API，兼容静态托管和 file://。

## 日期的含义

- `phone.updatedAt` / `gdp.updatedAt`：本地成功获取这批来源的 UTC 日期，**不是全部记录经过官方逐项核验的日期**，也不是官方发布时间。
- `gdp.sourceUpdatedAt`：世界银行 API 响应的 `lastupdated` 字段，是数据源提供的更新日期，不能据此断言每个经济体观测值都在当天修订。
- 原始清单 `retrievedAt`：实际抓取时间。离线重建不会以生成时间改写它。
- 电话源 ITU 列表不提供可统一代表所有编号计划的发布日期，因此没有虚构 `sourceUpdatedAt`。

## GDP：定义、映射、默认年

来源为 [World Bank WDI](https://data.worldbank.org/indicator/NY.GDP.PCAP.CD)，指标 `NY.GDP.PCAP.CD`，即 **GDP per capita (current US$)**：现价美元、非 PPP、非不变价。按 World Bank 三字母代码连接国家元数据和指标观测，不按英文名模糊匹配。先排除元数据 `region.id == 'NA'` 的所有汇总项，保留 217 个经济体，包括全部年份无值的经济体。

`values` 保留各年实际数值，不自行四舍五入；API null 以缺少年份键表示，绝不转成 0。默认年份是**至少 90% 全体非汇总经济体具有非 null 值的最新年份**；没有任何年份达到阈值则更新失败，避免悄悄改变统计口径。

当前实际源更新日期为 2026-11-11，获取区间 2020–2025：2025 年 186/217、2024 年 200/217、2023 年 204/217、2022 年 209/217、2021 年 210/217、2020 年 210/217。因此默认 **2024 年**；2025 年仍可选，但覆盖不全。

中文及显示名称主要来自原项目的电话资料，按代码对应。[country-seed.json](country-seed.json) 保存名称表；修正了多米尼克 / 多米尼加共和国的混淆，补充南极洲和赫德岛、麦克唐纳群岛。`XK / XKX` 为实用代码（世界银行使用 XKX），不是正式 ISO 分配。`JG / CHI` 是世界银行海峡群岛经济体代码，不是 ISO 国家代码；该条不虚构国旗，并用 record.note 说明。GDP record 的可选 `note` 为集成负责人批准的 schema 补充。

## 电话：官方列表与未全面核验范围

官方来源：[ITU National Numbering Plans](https://www.itu.int/oth/T0202.aspx?lang=en&parent=T0202)。[itu-map.json](itu-map.json) 将 230 个显示地区映射到 ITU 稳定文档 ID；更新器只解析 HTML option 文本，**不执行网页 JavaScript**，以后更新不会按名称猜测映射。完整 [ITU HTML 原始响应](../data/raw/itu.html) 用于离线重现和复核。

- US +1、RU +7、KZ +7 直接取官方列表，修正原来的 +1201 / +73 / +76。
- 北美编号计划地区 `callingCode` 是 +1，`prefixes` 列出 ITU 公布的完整拨号前缀；DO 为 +1809/+1829/+1849，PR 为 +1787/+1939，JM 为 +1876/+1658。
- 美国、加拿大不枚举全部国内区号；`prefixes` 不是所有可拨号码/移动网络前缀的穷举。
- SH 这一 ISO 地区涵盖圣赫勒拿/特里斯坦-达库尼亚 +290 和阿森松 +247：`callingCode: null` 表示不能归为一个国家码，两个有效前缀仍列出。
- UM、BV、AQ、HM、TF、GS：本轮未确认统一且普遍适用的地区呼叫码，保守留空并说明，不用所属国号或错误旧值代替。
- **其余 14 个未由 ITU 列表独立确认的条目**：BL、CX、MF、AX、SJ、GG、VA、JE、RE、PN、CC、EH、IM、YT。资料继承自[原项目固定历史提交](https://github.com/DMSQ-creator/tools-page/blob/12e598c29471a5ae91fbfe4437fbc956e4c8d21a/index.html)，仅将明显的国家码/地区前缀拆开（如 AX +358 / +35818、SJ +47 / +4779、VA +39 / +3906698、EH +212 / +2125288），每条均有“本轮未逐项核验当地官方编号计划”注记。这些资料**不是声称已经官方核验**，也不保证覆盖所有固定/移动/卫星业务。

即使映射到 ITU 的 230 条，也只是对照其当前列表，并未逐份阅读所有国家编号计划或运营商通知；无法声称所有细节完全最新、穷尽或全量官方核验。新增/调整共享地区号码时应检查当地监管机构或 ITU 详细计划，并保留来源。
