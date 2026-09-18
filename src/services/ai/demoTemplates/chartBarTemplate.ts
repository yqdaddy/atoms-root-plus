/**
 * 演示模板：柱状图。
 * Chart.js 柱状图模板，支持多数据集、响应式布局、深浅色主题。
 * 约束：内容不含反引号、${、反斜杠与 em-dash，保证可安全内嵌 TS 模板字符串。
 */
import type { DemoTemplate } from './types';

export const CHART_BAR_TEMPLATE: DemoTemplate = {
  id: 'chart-bar',
  name: '柱状图',
  description: '使用 Chart.js 的柱状图模板，支持多数据集对比',
  keywords: {
    strong: ['柱状图', 'bar chart', '柱形图', '条形图'],
    weak: ['对比', '比较', '统计', '数据'],
  },
  analystScript: {
    appTitle: '柱状图',
    appType: 'chart-bar',
    summary: '多数据集柱状图，支持分组对比与深浅色主题',
    features: [
      { id: 'F1', name: '柱状图展示', description: '多数据集分组柱状图', priority: 'must' },
      { id: 'F2', name: '悬浮提示', description: '鼠标悬浮查看数值', priority: 'must' },
      { id: 'F3', name: '图例交互', description: '点击图例显示或隐藏数据集', priority: 'must' },
      { id: 'F4', name: '深浅色主题', description: '支持深色和浅色主题切换', priority: 'nice' },
    ],
    interactions: [
      '鼠标悬浮柱体查看具体数值',
      '点击图例切换数据集显示',
      '切换深浅色主题',
    ],
    assumptions: ['演示数据为内置静态样本'],
  },
  defaults: { title: '销售对比分析', accent: '#2563eb', dark: false },
  html: `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>{{TITLE}}</title>
<script src="https://cdn.jsdelivr.net/npm/chart.js@4.4.1/dist/chart.umd.min.js"></script>
<style>
*{box-sizing:border-box;margin:0;padding:0}
:root{
  --accent:{{ACCENT}};
  --bg:#f4f5f7;--card:#ffffff;--text:#1f2937;--muted:#6b7280;--border:#e5e7eb;
  --shadow:0 1px 2px rgba(15,23,42,.05),0 10px 28px rgba(15,23,42,.07);
}
body[data-theme="dark"]{
  --bg:#0b1220;--card:#141d2c;--text:#e5eaf3;--muted:#8b96a8;--border:#26324a;
  --shadow:0 1px 2px rgba(0,0,0,.5),0 10px 28px rgba(0,0,0,.35);
}
body{font-family:system-ui,-apple-system,"PingFang SC","Microsoft YaHei",sans-serif;background:var(--bg);color:var(--text);line-height:1.6;min-height:100vh;padding:24px}
.container{max-width:800px;margin:0 auto}
.card{background:var(--card);border:1px solid var(--border);border-radius:14px;box-shadow:var(--shadow);padding:20px}
h1{font-size:22px;margin-bottom:16px}
.chart-container{position:relative;height:380px;width:100%}
.controls{display:flex;gap:10px;flex-wrap:wrap;margin-top:16px;justify-content:flex-end}
.ghost-btn{font:inherit;cursor:pointer;border:1px solid var(--border);border-radius:10px;padding:8px 14px;color:var(--muted);background:var(--card)}
.ghost-btn:hover{color:var(--accent);border-color:var(--accent)}
.fallback{padding:40px 16px;text-align:center;color:var(--muted)}
</style>
</head>
<body data-theme="{{THEME}}">
<div class="container">
  <div class="card">
    <h1>{{TITLE}}</h1>
    <div class="chart-container">
      <canvas id="barChart"></canvas>
    </div>
    <div class="controls">
      <button id="theme-btn" class="ghost-btn">切换深浅色</button>
    </div>
    <div id="fallback" class="fallback" hidden>图表库未能加载，请检查网络后刷新页面</div>
  </div>
</div>
<script>
(function(){
  'use strict';
  var THEME_KEY='atoms.chart-bar.theme';
  var state={theme:'light'};
  function load(){try{var r=localStorage.getItem(THEME_KEY);if(r==='dark'||r==='light')state.theme=r;}catch(e){}}
  function save(){try{localStorage.setItem(THEME_KEY,state.theme);}catch(e){}}
  function applyTheme(){document.body.setAttribute('data-theme',state.theme);}
  function isDark(){return state.theme==='dark';}
  function getTextColor(){return isDark()?'#8b96a8':'#6b7280';}
  function getGridColor(){return isDark()?'rgba(229,234,243,.16)':'rgba(31,41,55,.12)';}
  var chart=null;
  var data={
    labels:['1月','2月','3月','4月','5月','6月'],
    datasets:[
      {label:'今年',data:[65,78,90,81,96,105],backgroundColor:'rgba(37,99,235,.7)',borderColor:'rgba(37,99,235,1)',borderWidth:1,borderRadius:4},
      {label:'去年同期',data:[45,52,60,58,72,80],backgroundColor:'rgba(37,99,235,.35)',borderColor:'rgba(37,99,235,.5)',borderWidth:1,borderRadius:4}
    ]
  };
  function createChart(){
    var ctx=document.getElementById('barChart');
    if(!ctx)return;
    if(typeof Chart==='undefined'){document.getElementById('fallback').hidden=false;return;}
    chart=new Chart(ctx.getContext('2d'),{
      type:'bar',
      data:data,
      options:{
        responsive:true,
        maintainAspectRatio:false,
        plugins:{
          legend:{position:'top',labels:{color:getTextColor(),usePointStyle:true,pointStyle:'rectRounded'}},
          tooltip:{mode:'index',intersect:false,backgroundColor:isDark()?'#1e293b':'#ffffff',titleColor:isDark()?'#e5eaf3':'#1f2937',bodyColor:isDark()?'#cbd5e1':'#374151',borderColor:isDark()?'#334155':'#e5e7eb',borderWidth:1,padding:12,cornerRadius:8}
        },
        scales:{
          x:{grid:{display:false},ticks:{color:getTextColor()}},
          y:{grid:{color:getGridColor()},ticks:{color:getTextColor()},beginAtZero:true}
        }
      }
    });
  }
  function updateChartTheme(){
    if(!chart)return;
    chart.options.plugins.legend.labels.color=getTextColor();
    chart.options.plugins.tooltip.backgroundColor=isDark()?'#1e293b':'#ffffff';
    chart.options.plugins.tooltip.titleColor=isDark()?'#e5eaf3':'#1f2937';
    chart.options.plugins.tooltip.bodyColor=isDark()?'#cbd5e1':'#374151';
    chart.options.plugins.tooltip.borderColor=isDark()?'#334155':'#e5e7eb';
    chart.options.scales.x.ticks.color=getTextColor();
    chart.options.scales.y.grid.color=getGridColor();
    chart.options.scales.y.ticks.color=getTextColor();
    chart.update('none');
  }
  document.getElementById('theme-btn').addEventListener('click',function(){
    state.theme=isDark()?'light':'dark';
    applyTheme();
    save();
    updateChartTheme();
  });
  load();
  applyTheme();
  createChart();
})();
</script>
</body>
</html>`,
};