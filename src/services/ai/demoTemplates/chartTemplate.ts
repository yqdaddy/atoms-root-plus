/**
 * 演示模板：图表展示。
 * ECharts 多图（折线、柱状、饼图、散点）；数据集切换器、图表类型切换、
 * 悬浮提示；数据集与主题选择持久化在 localStorage。
 * 约束：内容不含反引号、${、反斜杠与 em-dash，保证可安全内嵌 TS 模板字符串。
 */
import type { DemoTemplate } from './types';

export const CHART_TEMPLATE: DemoTemplate = {
  id: 'chart',
  name: '图表展示',
  description: '折线、柱状、饼图、散点多图联动的可视化分析页',
  keywords: {
    strong: ['图表', 'chart', '可视化大屏'],
    weak: ['折线', '柱状', '饼图', '趋势', '数据分析', '分析'],
  },
  analystScript: {
    appTitle: '图表展示',
    appType: 'chart',
    summary: '折线、柱状、饼图、散点四图联动，支持数据集与图型切换',
    features: [
      { id: 'F1', name: '多图展示', description: '趋势、对比、占比、分布四类图表同屏', priority: 'must' },
      { id: 'F2', name: '数据集切换', description: '销售、访问、实验三套数据一键切换', priority: 'must' },
      { id: 'F3', name: '图型切换', description: '核心趋势在折线与柱状之间切换', priority: 'must' },
      { id: 'F4', name: '悬浮提示', description: '鼠标悬浮查看数值明细', priority: 'must' },
      { id: 'F5', name: '记住选择', description: '数据集与图型选择保存在 localStorage', priority: 'nice' },
      { id: 'F6', name: '深浅色主题', description: '图表配色随主题联动', priority: 'nice' },
    ],
    interactions: [
      '切换数据集，四张图表联动刷新',
      '点击折线、柱状切换核心趋势图型',
      '鼠标悬浮图表查看数值提示',
      '切换深浅色主题，坐标轴与配色联动',
      '刷新页面后自动恢复上次的图型与数据集',
    ],
    assumptions: ['演示数据为内置静态样本'],
  },
  defaults: { title: '可视化图表分析', accent: '#b45309', dark: false },
  html: `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>{{TITLE}}</title>
<script src="https://cdn.jsdelivr.net/npm/echarts@5.5.0/dist/echarts.min.js"></script>
<style>
*{box-sizing:border-box;margin:0;padding:0}
:root{
  --accent:{{ACCENT}};
  --bg:#f4f5f7;--card:#ffffff;--text:#1f2937;--muted:#6b7280;--border:#e5e7eb;
  --chart-grid:rgba(31,41,55,.12);--chart-text:#6b7280;--chart-bg:transparent;
  --shadow:0 1px 2px rgba(15,23,42,.05),0 10px 28px rgba(15,23,42,.07);
}
body[data-theme="dark"]{
  --bg:#0b1220;--card:#141d2c;--text:#e5eaf3;--muted:#8b96a8;--border:#26324a;
  --chart-grid:rgba(229,234,243,.16);--chart-text:#8b96a8;--chart-bg:transparent;
  --shadow:0 1px 2px rgba(0,0,0,.5),0 10px 28px rgba(0,0,0,.35);
}
body{font-family:system-ui,-apple-system,"PingFang SC","Microsoft YaHei",sans-serif;background:var(--bg);color:var(--text);line-height:1.6;-webkit-text-size-adjust:100%}
.app{max-width:1120px;margin:0 auto;padding:26px 18px 52px}
.topbar{display:flex;flex-wrap:wrap;gap:12px;justify-content:space-between;align-items:center;margin-bottom:20px}
.topbar h1{font-size:22px}
.controls{display:flex;gap:10px;flex-wrap:wrap;align-items:center}
select{font:inherit;color:inherit;background:var(--card);border:1px solid var(--border);border-radius:10px;padding:8px 12px;outline:none}
select:focus{border-color:var(--accent)}
button{font:inherit;cursor:pointer;border:none;background:none;color:inherit}
.ghost-btn{border:1px solid var(--border);border-radius:10px;padding:8px 14px;color:var(--muted);background:var(--card)}
.ghost-btn:hover{color:var(--accent);border-color:var(--accent)}
.segmented{display:inline-flex;border:1px solid var(--border);border-radius:10px;overflow:hidden;background:var(--card)}
.segmented button{padding:8px 16px;color:var(--muted)}
.segmented button.active{background:var(--accent);color:#fff;font-weight:600}
.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(440px,1fr));gap:16px}
@media (max-width:520px){.grid{grid-template-columns:1fr}}
.card{background:var(--card);border:1px solid var(--border);border-radius:14px;box-shadow:var(--shadow);padding:16px 18px}
.card h2{font-size:15px;color:var(--muted);font-weight:600;margin-bottom:4px}
.card .hint{font-size:12px;color:var(--muted);margin-bottom:8px}
.chart{height:300px;width:100%}
.fallback{padding:40px 16px;text-align:center;color:var(--muted)}
</style>
</head>
<body data-theme="{{THEME}}">
<div class="app">
  <header class="topbar">
    <h1>{{TITLE}}</h1>
    <div class="controls">
      <select id="dataset-select" title="数据集">
        <option value="sales" selected>销售数据</option>
        <option value="visit">访问数据</option>
        <option value="lab">实验数据</option>
      </select>
      <div class="segmented" id="type-switch">
        <button data-type="line" class="active">折线</button>
        <button data-type="bar">柱状</button>
      </div>
      <button id="theme-btn" class="ghost-btn">切换深浅色</button>
    </div>
  </header>
  <div class="grid">
    <div class="card">
      <h2>核心趋势</h2>
      <p class="hint">年度走势，可用上方按钮切换图型</p>
      <div id="chart-a" class="chart"></div>
    </div>
    <div class="card">
      <h2>分类对比</h2>
      <p class="hint">今年与去年同期逐月对比</p>
      <div id="chart-b" class="chart"></div>
    </div>
    <div class="card">
      <h2>构成占比</h2>
      <p class="hint">各渠道或类目的全年占比</p>
      <div id="chart-c" class="chart"></div>
    </div>
    <div class="card">
      <h2>相关性分布</h2>
      <p class="hint">两个变量的散点关系，悬浮查看明细</p>
      <div id="chart-d" class="chart"></div>
    </div>
  </div>
  <div id="echarts-fallback" class="fallback" hidden>图表库未能加载，请检查网络后刷新页面</div>
</div>
<script>
(function(){
  'use strict';
  var STORE_KEY='atoms.demo.chart.v1';
  var PALETTE=['#b45309','#0e7490','#059669','#7c3aed','#be185d'];
  var DATASETS={
    sales:{
      trendName:'月销售额（万元）',
      months:['1月','2月','3月','4月','5月','6月','7月','8月','9月','10月','11月','12月'],
      trend:[86,92,95,101,98,110,118,124,120,132,140,155],
      lastYear:[70,75,80,82,79,88,95,101,99,108,115,126],
      pieName:'渠道占比',
      pie:[
        {name:'线上商城',value:382},
        {name:'线下门店',value:291},
        {name:'分销渠道',value:178},
        {name:'团购直播',value:96},
        {name:'其他',value:53}
      ],
      scatterX:'广告投入（万元）',
      scatterY:'销售额（万元）',
      scatter:[[12,86],[15,95],[18,101],[22,118],[25,110],[28,132],[30,124],[33,140],[36,148],[38,155],[40,151],[42,163],[45,170],[48,178],[20,98],[26,121],[31,129],[35,138],[41,157],[47,172]]
    },
    visit:{
      trendName:'月活用户（千人）',
      months:['1月','2月','3月','4月','5月','6月','7月','8月','9月','10月','11月','12月'],
      trend:[120,132,128,145,160,158,178,196,205,224,241,268],
      lastYear:[98,105,110,118,125,131,140,152,161,170,183,196],
      pieName:'来源占比',
      pie:[
        {name:'搜索引擎',value:420},
        {name:'社交媒体',value:315},
        {name:'直接访问',value:268},
        {name:'外部引荐',value:130},
        {name:'邮件推送',value:74}
      ],
      scatterX:'人均浏览页数',
      scatterY:'人均停留（分钟）',
      scatter:[[2,3.1],[2.5,3.8],[3,4.2],[3.5,5.0],[4,5.6],[4.5,6.4],[5,7.1],[5.5,7.8],[6,8.5],[6.5,9.2],[7,9.8],[7.5,10.6],[8,11.4],[3.2,4.6],[4.8,6.0],[5.8,7.5],[6.8,9.0],[7.2,10.1],[8.4,12.2],[9,12.9]]
    },
    lab:{
      trendName:'样本活性指数',
      months:['批次1','批次2','批次3','批次4','批次5','批次6','批次7','批次8','批次9','批次10','批次11','批次12'],
      trend:[52,58,55,64,71,69,78,83,80,92,96,101],
      lastYear:[44,47,50,52,58,61,63,69,72,75,81,86],
      pieName:'设备状态占比',
      pie:[
        {name:'正常运行',value:820},
        {name:'低效预警',value:110},
        {name:'维护中',value:47},
        {name:'离线',value:23}
      ],
      scatterX:'环境湿度（%）',
      scatterY:'样本产率（%）',
      scatter:[[30,61],[35,63],[40,66],[45,70],[50,72],[55,75],[60,77],[65,74],[70,70],[75,66],[32,62],[38,65],[43,68],[48,71],[53,74],[58,76],[63,76],[68,72],[73,68],[78,63]]
    }
  };
  var state={dataset:'sales',type:'line',theme:'light'};

  function load(){
    try{
      var raw=localStorage.getItem(STORE_KEY);
      if(!raw)return;
      var data=JSON.parse(raw);
      if(!data||typeof data!=='object')return;
      if(data.dataset==='sales'||data.dataset==='visit'||data.dataset==='lab')state.dataset=data.dataset;
      if(data.type==='line'||data.type==='bar')state.type=data.type;
      if(data.theme==='dark'||data.theme==='light')state.theme=data.theme;
    }catch(e){
      /* 历史数据损坏时使用默认选择 */
    }
  }
  function save(){
    try{localStorage.setItem(STORE_KEY,JSON.stringify(state));}catch(e){/* 存储不可用时降级为内存态 */}
  }
  function current(){return DATASETS[state.dataset];}
  function cssVar(name){
    var v=getComputedStyle(document.body).getPropertyValue(name).trim();
    return v||'#6b7280';
  }
  var charts={a:null,b:null,c:null,d:null};
  function mount(id){
    var el=document.getElementById(id);
    if(!el)return null;
    return echarts.init(el);
  }
  function axisStyle(){
    return {
      axisLine:{lineStyle:{color:cssVar('--chart-grid')}},
      axisLabel:{color:cssVar('--chart-text')},
      splitLine:{lineStyle:{color:cssVar('--chart-grid')}}
    };
  }
  function palette(){
    var colors=PALETTE.slice();
    colors[0]=cssVar('--accent');
    return colors;
  }
  function optionA(){
    var ds=current();
    var accent=cssVar('--accent');
    var series={
      name:ds.trendName,
      type:state.type,
      data:ds.trend,
      itemStyle:{color:accent},
      lineStyle:{color:accent,width:2},
      barWidth:'46%',
      smooth:true,
      symbolSize:7
    };
    if(state.type==='line'){
      series.areaStyle={color:accent,opacity:0.12};
    }
    return {
      color:palette(),
      tooltip:{trigger:'axis'},
      grid:{left:52,right:22,top:28,bottom:34},
      xAxis:Object.assign({type:'category',data:ds.months},axisStyle()),
      yAxis:Object.assign({type:'value'},axisStyle()),
      series:[series]
    };
  }
  function optionB(){
    var ds=current();
    return {
      color:palette(),
      tooltip:{trigger:'axis'},
      legend:{bottom:0,textStyle:{color:cssVar('--chart-text')}},
      grid:{left:52,right:22,top:28,bottom:52},
      xAxis:Object.assign({type:'category',data:ds.months},axisStyle()),
      yAxis:Object.assign({type:'value'},axisStyle()),
      series:[
        {name:'今年',type:'bar',data:ds.trend,barWidth:'32%',itemStyle:{borderRadius:[5,5,0,0]}},
        {name:'去年同期',type:'bar',data:ds.lastYear,barWidth:'32%',itemStyle:{opacity:0.45,borderRadius:[5,5,0,0]}}
      ]
    };
  }
  function optionC(){
    var ds=current();
    return {
      color:palette(),
      tooltip:{trigger:'item',formatter:'{b}：{c}（{d}%）'},
      legend:{bottom:0,textStyle:{color:cssVar('--chart-text')}},
      series:[{
        name:ds.pieName,
        type:'pie',
        radius:['42%','68%'],
        center:['50%','44%'],
        data:ds.pie,
        label:{color:cssVar('--chart-text'),formatter:'{b} {d}%'},
        itemStyle:{borderRadius:6,borderColor:cssVar('--card'),borderWidth:2}
      }]
    };
  }
  function optionD(){
    var ds=current();
    return {
      color:PALETTE,
      tooltip:{trigger:'item',formatter:function(p){
        return ds.scatterX+'：'+p.value[0]+'，'+ds.scatterY+'：'+p.value[1];
      }},
      grid:{left:56,right:22,top:28,bottom:44},
      xAxis:Object.assign({type:'value',name:ds.scatterX,nameTextStyle:{color:cssVar('--chart-text')}},axisStyle()),
      yAxis:Object.assign({type:'value',name:ds.scatterY,nameTextStyle:{color:cssVar('--chart-text')}},axisStyle()),
      series:[{
        name:ds.scatterY,
        type:'scatter',
        data:ds.scatter,
        symbolSize:13,
        itemStyle:{color:cssVar('--accent'),opacity:0.75}
      }]
    };
  }
  function renderCharts(){
    var fallback=document.getElementById('echarts-fallback');
    if(typeof echarts==='undefined'){
      if(fallback)fallback.hidden=false;
      return;
    }
    if(fallback)fallback.hidden=true;
    if(!charts.a)charts.a=mount('chart-a');
    if(!charts.b)charts.b=mount('chart-b');
    if(!charts.c)charts.c=mount('chart-c');
    if(!charts.d)charts.d=mount('chart-d');
    if(charts.a)charts.a.setOption(optionA(),true);
    if(charts.b)charts.b.setOption(optionB(),true);
    if(charts.c)charts.c.setOption(optionC(),true);
    if(charts.d)charts.d.setOption(optionD(),true);
  }
  function applyTheme(){document.body.setAttribute('data-theme',state.theme);}
  function bindEvents(){
    var select=document.getElementById('dataset-select');
    if(select){
      select.value=state.dataset;
      select.addEventListener('change',function(){
        state.dataset=select.value;
        save();
        renderCharts();
      });
    }
    var typeWrap=document.getElementById('type-switch');
    if(typeWrap){
      typeWrap.addEventListener('click',function(e){
        var btn=e.target.closest('button');
        if(!btn)return;
        var type=btn.getAttribute('data-type');
        if(type!=='line'&&type!=='bar')return;
        state.type=type;
        save();
        var buttons=typeWrap.querySelectorAll('button');
        for(var i=0;i<buttons.length;i++){buttons[i].classList.toggle('active',buttons[i]===btn);}
        renderCharts();
      });
    }
    var themeBtn=document.getElementById('theme-btn');
    if(themeBtn)themeBtn.addEventListener('click',function(){
      state.theme=state.theme==='dark'?'light':'dark';
      applyTheme();
      save();
      renderCharts();
    });
    window.addEventListener('resize',function(){
      for(var key in charts){
        var chart=charts[key];
        if(chart)chart.resize();
      }
    });
  }
  (function init(){
    var typeWrap=document.getElementById('type-switch');
    if(typeWrap){
      var buttons=typeWrap.querySelectorAll('button');
      for(var i=0;i<buttons.length;i++){
        buttons[i].classList.toggle('active',buttons[i].getAttribute('data-type')===state.type);
      }
    }
  })();
  load();
  applyTheme();
  bindEvents();
  renderCharts();
})();
</script>
</body>
</html>`,
};
