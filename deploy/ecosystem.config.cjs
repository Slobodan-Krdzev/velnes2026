// PM2 definition for the Velnes API on the shared VPS (deploy/DEPLOY.md).
//
// Fork mode, exactly one instance — never cluster: the rate limiter is
// in-memory per process and the mail sender is serialised per process,
// so a second instance would split limits and could send a mail twice.
// Environment comes from /srv/velnes/api/.env via Node's --env-file.
//
//   pm2 start /srv/velnes/api/ecosystem.config.cjs && pm2 save
module.exports = {
  apps: [
    {
      name: 'velnes-api',
      cwd: '/srv/velnes/api',
      script: 'index.js',
      node_args: '--env-file=/srv/velnes/api/.env',
      exec_mode: 'fork',
      instances: 1,
      autorestart: true,
      max_memory_restart: '400M',
      time: true,
      kill_timeout: 8000,
    },
  ],
};
