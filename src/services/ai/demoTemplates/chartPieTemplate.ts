/**
 * 演示模板：饼图/环形图。
 * Chart.js 饼图模板，支持切换饼图/环形图模式。
 * 约束：内容不含反引号、${、反斜杠与 em-dash，保证可安全内嵌 TS 模板字符串。
 */
import type { DemoTemplate } from './types';

export const CHART_PIE_TEMPLATE: DemoTemplate = {
  id: 'chart-pie',
  name: '饼图',
  description: '使用 Chart.js 的饼图/环形图模板，支持占比分析',
  keywords: {
    strong: ['饼图', 'pie chart', '环形图', '占比图', '圆环图'],
    weak: ['占比', '构成', '分布', '比例'],
  },
  analystScript: {
    appTitle: '饼图',
    appType: 'chart-pie',
    summary: '饼图/环形图展示，支持占比分析与深浅色主题',
    features: [
      { id: 'F1', name: '饼图展示', description: '占比可视化', priority: 'must' },
      { id: 'F2', name: '图型切换', description: '饼图与环形图切换', priority: 'must' },
      { id: 'F3', name: '悬浮提示', description: '鼠标悬浮查看百分比', priority: 'must' },
      { id: 'F4', name: '深浅色主题', description: '支持深色和浅色主题切换', priority: 'nice' },
    ],
    interactions: [
      '点击切换饼图/环形图模式',
      '鼠标悬浮查看百分比',
      '切换深浅色主题',
    ],
    assumptions: ['演示数据为内置静态样本'],
  },
  defaults: { title: '渠道构成分析', accent: '#b45309', dark: false },
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
.container{max-width:600px;margin:0 auto}
.card{background:var(--card);border:1px solid var(--border);border-radius:14px;box-shadow:var(--shadow);padding:20px}
h1{font-size:22px;margin-bottom:16px}
.chart-container{position:relative;height:340px;width:100%;max-width:380px;margin:0 auto}
.controls{display:flex;gap:10px;flex-wrap:wrap;margin-top:16px;justify-content:center}
.segmented{display:inline-flex;border:1px solid var(--border);border-radius:10px;overflow:hidden;background:var(--card)}
.segmented button{padding:8px 16px;color:var(--muted);font:inherit;cursor:pointer;border:none;background:none}
.segmented button.active{background:var(--accent);color:#fff;font-weight:600}
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
      <canvas id="pieChart"></canvas>
    </div>
    <div class="controls">
      <div class="segmented" id="type-switch">
        <button data-type="pie" class="active">饼图</button>
        <button data-type="doughnut">环形图</button>
      </div>
      <button id="theme-btn" class="ghost-btn">切换深浅色</button>
    </div>
    <div id="fallback" class="fallback" hidden>图表库未能加载，请检查网络后刷新页面</div>
  </div>
</div>
<script>
(function(){
  'use strict';
  var THEME_KEY='atoms.chart-pie.theme';
  var TYPE_KEY='atoms.chart-pie.type';
  var state={theme:'light',type:'pie'};
  function load(){try{var t=localStorage.getItem(THEME_KEY);if(t==='dark'||t==='light')state.theme=t;var tp=localStorage.getItem(TYPE_KEY);if(tp==='pie'||tp==='doughnut')state.type=tp;}catch(e){}}
  function save(){try{localStorage.setItem(THEME_KEY,state.theme);localStorage.setItem(TYPE_KEY,state.type);}catch(e){}}
  function applyTheme(){document.body.setAttribute('data-theme',state.theme);}
  function isDark(){return state.theme==='dark';}
  function getTextColor(){return isDark()?'#8b96a8':'#6b7280';}
  var chart=null;
  var colors=['#b45309','#0e7490','#059669','#7c3aed','#be185d','#dc2626'];
  var data={
    labels:['线上商城','线下门店','分销渠道','团购直播','企业采购','其他'],
    datasets:[{data:[38.2,24.5,15.8,12.4,5.6,3.5],backgroundColor:colors,borderColor:isDark()?'#141d2c':'#ffffff',borderWidth:2,hoverOffset:8}]
  };
  function createChart(){
    var ctx=document.getElementById('pieChart');
    if(!ctx)return;
    if(typeof Chart==='undefined'){document.getElementById('fallback').hidden=false;return;}
    chart=new Chart(ctx.getContext('2d'),{
      type:state.type,
      data:data,
      options:{
        responsive:true,
        maintainAspectRatio:false,
        plugins:{
          legend:{position:'bottom',labels:{color:getTextColor(),usePointStyle:true,pointStyle:'circle',padding:16}},
          tooltip:{backgroundColor:isDark()?'#1e293b':'#ffffff',titleColor:isDark()?'#e5eaf3':'#1f2937',bodyColor:isDark()?'#cbd5e1':'#374151',borderColor:isDark()?'#334155':'#e5e7eb',borderWidth:1,padding:12,cornerRadius:8,callbacks:{label:function(ctx){return ctx.label+': '+ctx.parsed.toFixed(1)+'%';}}}
        },
        cutout:state.type==='doughnut'?'55%':0
      }
    });
  }
  function updateChartType(newType){
    if(!chart)return;
    state.type=newType;
    chart.config.type=newType;
    chart.options.cutout=newType==='doughnut'?'55%':0;
    chart.update();
    save();
  }
  function updateChartTheme(){
    if(!chart)return;
    data.datasets[0].borderColor=isDark()?'#141d2c':'#ffffff';
    chart.options.plugins.legend.labels.color=getTextColor();
    chart.options.plugins.tooltip.backgroundColor=isDark()?'#1e293b':'#ffffff';
    chart.options.plugins.tooltip.titleColor=isDark()?'#e5eaf3':'#1f2937';
    chart.options.plugins.tooltip.bodyColor=isDark()?'#cbd5e1':'#374151';
    chart.options.plugins.tooltip.borderColor=isDark()?'#334155':'#e5e7eb';
    chart.update('none');
  }
  document.getElementById('type-switch').addEventListener('click',function(e){
    var btn=e.target.closest('button');
    if(!btn)return;
    var type=btn.getAttribute('data-type');
    if(type!=='pie'&&type!=='doughnut')return;
    var buttons=document.querySelectorAll('#type-switch button');
    for(var i=0;i<buttons.length;i++){buttons[i].classList.toggle('active',buttons[i]===btn);}
    updateChartType(type);
  });
  document.getElementById('theme-btn').addEventListener('click',function(){
    state.theme=isDark()?'light':'dark';
    applyTheme();
    save();
    updateChartTheme();
  });
  load();
  applyTheme();
  (function initType(){
    var buttons=document.querySelectorAll('#type-switch button');
    for(var i=0;i<buttons.length;i++){buttons[i].classList.toggle('active',buttons[i].getAttribute('data-type')===state.type);}
  })();
  createChart();
})();
</script>
</body>
</html>`,
};