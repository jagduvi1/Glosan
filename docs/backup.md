# Backups

Glosan's only irreplaceable state is MongoDB. The backend mounts no volumes —
there are no uploaded files on disk — so a `mongodump` of the `glosan`
database is the complete backup.

Backups go to a **Hetzner Storage Box** via [restic](https://restic.net),
which encrypts client-side, deduplicates, and enforces retention. The same
setup runs for Cellarion on the other VM.

| | |
|---|---|
| Nightly backup | 02:30 (+ up to 15 min jitter) |
| Weekly integrity check | Sundays 03:30 |
| Retention | 7 daily, 4 weekly, 6 monthly |
| Repository | `sftp:storagebox:/home/backups/glosan` |

## Why this shape

- **Nightly, not hourly.** Vocabulary lists change slowly; a day of loss is
  acceptable and the repo stays small.
- **`Persistent=true`** on the timer, so a VM that was down at 02:30 takes the
  missed run at boot instead of silently skipping a day.
- **A weekly `restic check`.** Corruption in a backup repository is invisible
  until the day you need it. The check reads 5% of the data, which is enough to
  catch bit-rot over time without a full download every week.
- **A minimum-size guard** in `backup.sh`. `mongodump` of an empty database
  exits 0 and writes a tiny archive; without the guard, a broken database would
  produce valid-looking snapshots that rotate the good ones away within a week.

## First-time setup on the VM

Everything below runs as `johan` on the Glosan VM. Only step 5 needs `sudo`.

### 1. Install restic

restic is a single static binary, so it needs no package manager:

```bash
mkdir -p ~/bin
curl -fsSL https://github.com/restic/restic/releases/download/v0.16.4/restic_0.16.4_linux_amd64.bz2 \
  | bunzip2 > ~/bin/restic
chmod +x ~/bin/restic
echo 'export PATH="$HOME/bin:$PATH"' >> ~/.bashrc
```

### 2. Give the VM access to the Storage Box

```bash
ssh-keygen -t ed25519 -f ~/.ssh/id_ed25519_storagebox -N "" -C "glosan-vm-backup"
```

Then append `~/.ssh/id_ed25519_storagebox.pub` to the Storage Box's
`~/.ssh/authorized_keys`.

### 3. Add the `storagebox` host entry

```
Host storagebox
  HostName u558300.your-storagebox.de
  User u558300
  Port 23
  IdentityFile ~/.ssh/id_ed25519_storagebox
  BatchMode yes
  StrictHostKeyChecking accept-new
```

### 4. Configure and initialise

```bash
cd ~/apps/glosan/scripts/backup
cp backup.env.example backup.env && chmod 600 backup.env
# edit backup.env — set RESTIC_PASSWORD to a long random string
./backup.sh
```

> **Store `RESTIC_PASSWORD` somewhere other than this VM.** Without it the
> snapshots are unreadable, and a password that only exists on the machine the
> backup protects is no password at all. Put it in a password manager.

### 5. Install the timers

```bash
sudo cp systemd/glosan-backup*.{service,timer} /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now glosan-backup.timer glosan-backup-check.timer
systemctl list-timers 'glosan-*' --no-pager
```

## Restoring

```bash
cd ~/apps/glosan/scripts/backup
./restore.sh            # latest snapshot
./restore.sh 4b37e685   # a specific one — see `restic snapshots`
```

It asks for confirmation, then runs `mongorestore --drop`, replacing the
current database.

**Run a restore drill periodically.** An untested backup is not a backup — the
failure modes (wrong database name, a password nobody wrote down, an
`authorized_keys` entry that was rotated away) only surface when you try.

## Monitoring

`HEALTHCHECK_URL` and `HEALTHCHECK_CHECK_URL` in `backup.env` take a
dead-man's-switch URL (healthchecks.io or similar). The scripts ping it on
success and `<URL>/fail` on failure, so a backup that stops running raises an
alarm instead of being discovered during an incident.

This matters more than it looks. In August 2026 Glosan was down for three
weeks because the disk filled up and MongoDB crashed — nobody noticed, because
the only monitoring watched the front page, which nginx kept serving happily
without a backend. Whatever watches the backups should also watch
`/api/health`, not `/`.

## Off-provider copy

`B2_RESTIC_REPOSITORY` and the `B2_*` credentials enable a second copy to
Backblaze B2 after each run. It is off by default. Turn it on if losing the
whole Hetzner account is a risk worth insuring against — the Storage Box and
both VMs live in the same account today.
