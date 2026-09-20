module.exports = {
  apps: [{
    name: 'atoms-backend',
    script: 'dist-server/index.js',
    // 内存超 180MB 自动重启，防止 OOM
    max_memory_restart: '180M',
    // Node.js 内存优化参数
    node_args: '--max-old-space-size=128 --max-semi-space-size=1',
    // 生产环境
    env: {
      NODE_ENV: 'production',
      // 抑制不必要的警告
      NODE_NO_WARNINGS: '1'
    },
    // 日志配置（减少内存中的日志缓存）
    log_date_format: 'YYYY-MM-DD HH:mm:ss',
    merge_logs: true,
    // 异常自动重启
    exp_backoff_restart_delay: 100,
    max_restarts: 10,
    // 优雅关闭
    kill_timeout: 3000,
    wait_ready: true,
    listen_timeout: 3000
  }]
};