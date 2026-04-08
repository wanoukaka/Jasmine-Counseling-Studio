module.exports = {
  apps: [{
    name: 'jasmine',
    script: 'index.js',
    cwd: __dirname,
    interpreter: 'node',
    exec_mode: 'fork',
    watch: false,
    autorestart: true,
    max_restarts: 10,
    min_uptime: 5000,
    restart_delay: 3000,
    env: {
      NODE_ENV: 'production',
      PORT: 3001
    }
  }]
}
