module.exports = {
  apps: [
    {
      name: "devnuby-ai",
      script: "node_modules/next/dist/bin/next",
      args: "start -p 6752 -H 0.0.0.0",
      instances: 1,
      exec_mode: "fork",
      autorestart: true,
      watch: false,
      max_memory_restart: "2500M",
      env: {
        NODE_ENV: "production",
        PORT: 6752,
      },
    },
  ],
};
