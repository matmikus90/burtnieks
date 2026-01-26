# Deployment notes

## Pulling updates on a server

If you want the newest changes, make sure you're on the correct branch and that the branch exists on the remote.

```bash
git fetch origin
git branch --show-current
git pull origin <branch>
```

If the changes were created on a different branch (for example `work`), merge them into your target branch:

```bash
git fetch origin
git checkout main
git merge origin/work
```

If `origin/work` does not exist, it means the branch was never pushed. In that case, push it from the machine that has it:

```bash
git push origin work
```

After pulling, restart the service using your process manager (systemd/pm2/docker) as needed.
