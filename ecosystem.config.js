module.exports = {
  apps: [
    {
      name: 'rent-manager',
      script: './backend/server.js',
      cwd: './backend',
      env: {
        NODE_ENV: 'production',
        PORT: 5000
      }
    }
  ]
};
