/* One registry for navigation, tool search, titles and shareable routes. */
(function (root) {
  'use strict';
  const tools = [
    {id:'phone-code',name:'国家区号',icon:'↗',category:'国家与地区',description:'查找国际呼叫码与地区拨号前缀',keywords:'电话 phone country calling code',kind:'phone',placeholder:'搜索国家、英文名、区号或代码…'},
    {id:'gdp',name:'人均 GDP',icon:'▥',category:'国家与地区',description:'按年份查询和比较各经济体人均 GDP',keywords:'经济 排名 gross domestic product',kind:'gdp',placeholder:'搜索国家、英文名或代码…'},
    {id:'local-time',name:'当地时间 / 时差',icon:'◷',category:'运营辅助',description:'查看主要市场城市时间，按指定日期换算时差',keywords:'时区 夏令时 timezone time clock 城市',kind:'clock'},
    {id:'utm-builder',name:'UTM 链接生成',icon:'↗',category:'运营辅助',description:'统一渠道参数，生成可追踪的推广链接',keywords:'广告 营销 渠道 campaign tracking 链接',kind:'utm'},
    {id:'ip-risk',name:'IP 风控',icon:'◎',category:'网络查询',description:'查看 IP 信息与网络风险评估',keywords:'网络 地址 risk network',kind:'ip',url:'https://ip.heiqia.eu.org/'}
  ];
  root.TOOLS_REGISTRY = tools;
  if (typeof module !== 'undefined' && module.exports) module.exports = tools;
})(typeof window === 'undefined' ? globalThis : window);
