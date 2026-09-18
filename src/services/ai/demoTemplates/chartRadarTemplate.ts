/**
 * 演示模板：雷达图。
 * Chart.js 雷达图模板，支持多维度对比。
 * 约束：内容不含反引号、${、反斜杠与 em-dash，保证可安全内嵌 TS 模板字符串。
 */
import type { DemoTemplate } from './types';

export const CHART_RADAR_TEMPLATE: DemoTemplate = {
  id: 'chart-radar',
  name: '雷达图',
  description: '使用 Chart.js 的雷达图模板，支持多维度对比',
  keywords: {
    strong: ['雷达图', 'radar chart', '蜘蛛图', '网状图'],
    weak: ['维度', '能力', '评价', '对比'],
  },
  analystScript: {
    appTitle: '雷达图',
    appType: 'chart-radar',
    summary: '多维度雷达图，支持能力对比与深浅色主题',
    features: [
      { id: 'F1', name: '雷达图展示', description: '多维度可视化', priority: 'must' },
      { id: 'F2', name: '多数据集对比', description: '支持多对象对比', priority: 'must' },
      { id: 'F3', name: '悬浮提示', description: '鼠标悬浮查看数值', priority: 'must' },
      { id: 'F4', name: '深浅色主题', description: '支持深色和浅色主题切换', priority: 'nice' },
    ],
    interactions: [
      '鼠标悬浮查看各维度得分',
      '点击图例切换数据集显示',
      '切换深浅色主题',
    ],
    assumptions: ['演示数据为内置静态样本'],
  },
  defaults: { title: '能力评估分析', accent: '#7c3aed', dark: false },
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
.chart-container{position:relative;height:380px;width:100%;max-width:420px;margin:0 auto}
.controls{display:flex;gap:10px;flex-wrap:wrap;margin-top:16px;justify-content:center}
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
      <canvas id="radarChart"></canvas>
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
  var THEME_KEY='atoms.chart-radar.theme';
  var state={theme:'light'};
  function load(){try{var r=localStorage.getItem(THEME_KEY);if(r==='dark'||r==='light')state.theme=r;}catch(e){}}
  function save(){try{localStorage.setItem(THEME_KEY,state.theme);}catch(e){}}
  function applyTheme(){document.body.setAttribute('data-theme',state.theme);}
  function isDark(){return state.theme==='dark';}
  function getTextColor(){return isDark()?'#8b96a8':'#6b7280';}
  function getGridColor(){return isDark()?'rgba(229,234,243,.24)':'rgba(31,41,55,.18)';}
  var chart=null;
  var data={
    labels:['技术能力','沟通协作','项目管理','创新思维','学习能力','执行效率'],
    datasets:[
      {label:'张明',data:[85,72,80,68,90,75],fill:true,backgroundColor:'rgba(124,58,237,.2)',borderColor:'#7c3aed',pointBackgroundColor:'#7c3aed',pointBorderColor:isDark()?'#141d2c':'#ffffff',pointHoverBackgroundColor:'#7c3aed',pointHoverBorderColor:isDark()?'#0b1220':'#ffffff'},
      {label:'李华',data:[78,88,70,82,75,85],fill:true,backgroundColor:'rgba(14,116,144,.2)',borderColor:'#0e7490',pointBackgroundColor:'#0e7490',pointBorderColor:isDark()?'#141d2c':'#ffffff',pointHoverBackgroundColor:'#0e7490',pointHoverBorderColor:isDark()?'#0b1220':'#ffffff'}
    ]
  };
  function createChart(){
    var ctx=document.getElementById('radarChart');
    if(!ctx)return;
    if(typeof Chart==='undefined'){document.getElementById('fallback').hidden=false;return;}
    chart=new Chart(ctx.getContext('2d'),{
      type:'radar',
      data:data,
      options:{
        responsive:true,
        maintainAspectRatio:false,
        plugins:{
          legend:{position:'top',labels:{color:getTextColor(),usePointStyle:true,pointStyle:'circle'}},
          tooltip:{backgroundColor:isDark()?'#1e293b':'#ffffff',titleColor:isDark()?'#e5eaf3':'#1f2937',bodyColor:isDark()?'#cbd5e1':'#374151',borderColor:isDark()?'#334155':'#e5e7eb',borderWidth:1,padding:12,cornerRadius:8}
        },
        scales:{
          r:{
            angleLines:{color:getGridColor()},
            grid:{color:getGridColor()},
            pointLabels:{color:getTextColor(),font:{size:12}},
            ticks:{color:getTextColor(),backdropColor:'transparent',stepSize:20},
            suggestedMin:0,
            suggestedMax:100
          }
        }
      }
    });
  }
  function updateChartTheme(){
    if(!chart)return;
    data.datasets[0].pointBorderColor=isDark()?'#141d2c':'#ffffff';
    data.datasets[0].pointHoverBorderColor=isDark()?'#0b1220':'#ffffff';
    data.datasets[1].pointBorderColor=isDark()?'#141d2c':'#ffffff';
    data.datasets[1].pointHoverBorderColor=isDark()?'#0b1220':'#ffffff';
    chart.options.plugins.legend.labels.color=getTextColor();
    chart.options.plugins.tooltip.backgroundColor=isDark()?'#1e293b':'#ffffff';
    chart.options.plugins.tooltip.titleColor=isDark()?'#e5eaf3':'#1f2937';
    chart.options.plugins.tooltip.bodyColor=isDark()?'#cbd5e1':'#374151';
    chart.options.plugins.tooltip.borderColor=isDark()?'#334155':'#e5e7eb';
    chart.options.scales.r.angleLines.color=getGridColor();
    chart.options.scales.r.grid.color=getGridColor();
    chart.options.scales.r.pointLabels.color=getTextColor();
    chart.options.scales.r.ticks.color=getTextColor();
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