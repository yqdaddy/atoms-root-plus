/**
 * 权限系统使用示例。
 * 展示如何在应用中集成三态权限控制。
 */

import { usePermissionStore } from '../stores/permissionStore';
import { usePermissionGuard } from '../components/PermissionDialog';
import type { PermissionRequest } from '../types/permission';

/**
 * 示例：在沙箱创建前检查权限
 */
export function exampleSandboxCreate() {
  const { guard } = usePermissionGuard();

  const request: PermissionRequest = {
    toolName: 'sandbox.create',
    params: {
      framework: 'react-cdn',
      files: ['index.html', 'index.jsx'],
    },
    riskNote: '将在沙箱中创建并执行用户代码',
  };

  guard(request).then((decision) => {
    if (decision.allowed) {
      console.log('权限已授予，可以创建沙箱');
      // 执行创建操作
    } else {
      console.log('权限被拒绝');
      // 显示错误提示
    }
  });
}

/**
 * 示例：在文件操作前检查权限
 */
export function exampleFileWrite(filePath: string, content: string) {
  const requestPermission = usePermissionStore.getState().requestPermission;

  requestPermission({
    toolName: 'file.write',
    params: {
      path: filePath,
      contentLength: content.length,
    },
    riskNote: `将修改文件：${filePath}`,
  }).then((decision) => {
    if (decision.allowed) {
      console.log('写入文件:', filePath);
    } else {
      console.log('写入被拒绝');
    }
  });
}

/**
 * 示例：在设置中修改权限规则
 */
export function exampleUpdatePermissionRules() {
  const store = usePermissionStore.getState();

  // 设置分类默认规则
  store.setCategoryPermission('network', 'ask');

  // 设置具体工具权限
  store.setToolPermission('file.delete', 'deny');

  // 清除工具覆盖规则（恢复分类默认）
  store.clearToolPermission('file.delete');

  // 重置所有权限配置
  store.resetToDefault();
}

/**
 * 集成到 HomePage 的示例代码
 *
 * 在 HomePage.tsx 中添加：
 *
 * import PermissionDialog from '../components/PermissionDialog';
 *
 * // 在组件中添加状态
 * const [showPermissionDialog, setShowPermissionDialog] = useState(false);
 *
 * // 在 JSX 中渲染弹窗
 * <PermissionDialog
 *   open={showPermissionDialog}
 *   onClose={() => setShowPermissionDialog(false)}
 * />
 *
 * // 监听权限 store 的 pendingRequest 状态
 * const pendingRequest = usePermissionStore((s) => s.pendingRequest);
 *
 * // 当有 pendingRequest 时自动显示弹窗
 * useEffect(() => {
 *   setShowPermissionDialog(!!pendingRequest);
 * }, [pendingRequest]);
 */