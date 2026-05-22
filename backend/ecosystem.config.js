module.exports = {
  apps: [
    {
      name: 'rentmanager-backend',
      script: 'server.js',
      cwd: '/home/dckakadia/RentManager/backend', // ← update path if different on your server
      instances: 1,
      autorestart: true,
      watch: false,
      max_memory_restart: '500M',

      // 🕐 Lock timezone at PM2 process level — belt AND suspenders
      env: {
        NODE_ENV: 'production',
        TZ: 'Asia/Kolkata',
        PORT: 5000,
      },

      // Log files
      out_file: '/home/dckakadia/logs/rentmanager-out.log',
      error_file: '/home/dckakadia/logs/rentmanager-error.log',
      merge_logs: true,
      time: true, // prefix logs with IST timestamp
    },
  ],
};
