/**
 * 本地图标注册模块。
 *
 * 所有图标来自 assets/icons/lucide/（由 iconify-local skill 的 fetch-icons.sh
 * 下载），通过 ?raw 导入后在运行时注册到 @iconify/react，实现零网络依赖：
 * <Icon icon="lucide:xxx" /> 完全离线可用，不发任何请求。
 *
 * 新增图标流程：fetch-icons.sh 下载 SVG 后，在本文件新增一行导入与注册。
 */
import { addCollection } from '@iconify/react';

import atom from '../../assets/icons/lucide/atom.svg?raw';
import alertCircle from '../../assets/icons/lucide/alert-circle.svg?raw';
import arrowUp from '../../assets/icons/lucide/arrow-up.svg?raw';
import bot from '../../assets/icons/lucide/bot.svg?raw';
import check from '../../assets/icons/lucide/check.svg?raw';
import chevronDown from '../../assets/icons/lucide/chevron-down.svg?raw';
import chevronRight from '../../assets/icons/lucide/chevron-right.svg?raw';
import code from '../../assets/icons/lucide/code.svg?raw';
import code2 from '../../assets/icons/lucide/code-2.svg?raw';
import copy from '../../assets/icons/lucide/copy.svg?raw';
import database from '../../assets/icons/lucide/database.svg?raw';
import download from '../../assets/icons/lucide/download.svg?raw';
import eye from '../../assets/icons/lucide/eye.svg?raw';
import eyeOff from '../../assets/icons/lucide/eye-off.svg?raw';
import file from '../../assets/icons/lucide/file.svg?raw';
import fileCode from '../../assets/icons/lucide/file-code.svg?raw';
import fileText from '../../assets/icons/lucide/file-text.svg?raw';
import folder from '../../assets/icons/lucide/folder.svg?raw';
import gitCompare from '../../assets/icons/lucide/git-compare.svg?raw';
import hammer from '../../assets/icons/lucide/hammer.svg?raw';
import helpCircle from '../../assets/icons/lucide/help-circle.svg?raw';
import history from '../../assets/icons/lucide/history.svg?raw';
import home from '../../assets/icons/lucide/home.svg?raw';
import layers from '../../assets/icons/lucide/layers.svg?raw';
import layoutTemplate from '../../assets/icons/lucide/layout-template.svg?raw';
import lightbulb from '../../assets/icons/lucide/lightbulb.svg?raw';
import listChecks from '../../assets/icons/lucide/list-checks.svg?raw';
import loaderCircle from '../../assets/icons/lucide/loader-circle.svg?raw';
import logOut from '../../assets/icons/lucide/log-out.svg?raw';
import maximize2 from '../../assets/icons/lucide/maximize-2.svg?raw';
import menu from '../../assets/icons/lucide/menu.svg?raw';
import messageSquare from '../../assets/icons/lucide/message-square.svg?raw';
import minimize2 from '../../assets/icons/lucide/minimize-2.svg?raw';
import monitor from '../../assets/icons/lucide/monitor.svg?raw';
import palette from '../../assets/icons/lucide/palette.svg?raw';
import pencil from '../../assets/icons/lucide/pencil.svg?raw';
import play from '../../assets/icons/lucide/play.svg?raw';
import plus from '../../assets/icons/lucide/plus.svg?raw';
import rocket from '../../assets/icons/lucide/rocket.svg?raw';
import refreshCw from '../../assets/icons/lucide/refresh-cw.svg?raw';
import search from '../../assets/icons/lucide/search.svg?raw';
import searchCode from '../../assets/icons/lucide/search-code.svg?raw';
import send from '../../assets/icons/lucide/send.svg?raw';
import settings from '../../assets/icons/lucide/settings.svg?raw';
import shieldCheck from '../../assets/icons/lucide/shield-check.svg?raw';
import smartphone from '../../assets/icons/lucide/smartphone.svg?raw';
import sparkles from '../../assets/icons/lucide/sparkles.svg?raw';
import tablet from '../../assets/icons/lucide/tablet.svg?raw';
import trash2 from '../../assets/icons/lucide/trash-2.svg?raw';
import upload from '../../assets/icons/lucide/upload.svg?raw';
import user from '../../assets/icons/lucide/user.svg?raw';
import x from '../../assets/icons/lucide/x.svg?raw';

/** 解析本地 SVG 文本为 iconify 图标数据（body + 尺寸） */
function parseSvg(raw: string): { body: string; width: number; height: number } {
  const viewBoxMatch = raw.match(/viewBox="([^"]+)"/);
  const viewBox = viewBoxMatch?.[1] ?? '0 0 24 24';
  const parts = viewBox.split(/\s+/);
  const width = Number(parts[2] ?? 24);
  const height = Number(parts[3] ?? 24);
  const body = raw
    .replace(/^[\s\S]*?<svg[^>]*>/, '')
    .replace(/<\/svg>\s*$/, '')
    .trim();
  return { body, width, height };
}

/** 图标名到 SVG 原文的映射，与 assets/icons/index.json 保持一致 */
const LOCAL_ICONS: Record<string, string> = {
  atom,
  'alert-circle': alertCircle,
  'arrow-up': arrowUp,
  bot,
  check,
  'chevron-down': chevronDown,
  'chevron-right': chevronRight,
  code,
  'code-2': code2,
  copy,
  database,
  download,
  eye,
  'eye-off': eyeOff,
  file,
  'file-code': fileCode,
  'file-text': fileText,
  folder,
  'git-compare': gitCompare,
  hammer,
  'help-circle': helpCircle,
  history,
  home,
  layers,
  'layout-template': layoutTemplate,
  lightbulb,
  'list-checks': listChecks,
  'loader-circle': loaderCircle,
  'log-out': logOut,
  'maximize-2': maximize2,
  menu,
  'message-square': messageSquare,
  'minimize-2': minimize2,
  monitor,
  palette,
  pencil,
  play,
  plus,
  rocket,
  'refresh-cw': refreshCw,
  search,
  'search-code': searchCode,
  send,
  settings,
  'shield-check': shieldCheck,
  smartphone,
  sparkles,
  tablet,
  'trash-2': trash2,
  upload,
  user,
  x,
};

let registered = false;

/** 注册全部本地图标。模块导入时执行一次，重复调用安全。 */
export function registerLocalIcons(): void {
  if (registered) return;
  registered = true;

  const icons: Record<string, { body: string; width: number; height: number }> = {};
  for (const [name, raw] of Object.entries(LOCAL_ICONS)) {
    icons[name] = parseSvg(raw);
  }
  addCollection({
    prefix: 'lucide',
    icons,
  });
}

registerLocalIcons();
