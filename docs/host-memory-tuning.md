# Host memory tuning — TWO changes, applied together

**Status: proposed, awaiting the owner's approval. Nothing here is applied.**

These are one change in two files. Applying only the first makes the planner reason from a
number that is no longer true, so do both in the same sitting or neither.

---

## The measurements this is derived from

This machine, 2026-09-21. Source named beside each figure, because the units decide the meaning:

| Figure | Value |
|---|---|
| `Win32_OperatingSystem.TotalVisibleMemorySize` | **8030 MB installed** — physical RAM, not configurable |
| `Win32_OperatingSystem.FreePhysicalMemory` | 21 MB at worst; 1133 MB after closing one desktop app |
| `\Memory\Commit Limit` | 31.84 GB (8 GB RAM + a 23.76 GB pagefile) |
| `\Memory\Committed Bytes` | 30.89 GB at worst = **98% of the limit** |
| `\Processor(_Total)\% Processor Time` | 100% of 8 logical cores at worst |
| `vmmemWSL.PrivateMemorySize64` | **3941 MB committed, with NO `.wslconfig`** — i.e. uncapped |
| `Win32_Processor` | 4 physical cores, 8 logical |
| WSL distros (`wsl -l -v`) | `docker-desktop` only, WSL 2.1.5.0 |
| `pg_settings.shared_buffers` | 16384 × 8kB = **128 MB** per instance (image default) |
| `pg_settings.effective_cache_size` | 524288 × 8kB = **4 GB** per instance, `source = default` |
| `ibms-app_db-test-data` volume | 6.09 GB |

At 98% commit, **vitest could not fork worker processes at all** ("Failed to start forks
worker"), a 6-test spec file took 210s, and a teardown that normally finishes in 15s took 50s and
was aborted partway — corrupting shared state for 36 later tests in three other files.

> **A correction to an earlier version of this file**, which claimed `effective_cache_size = 5 GB`
> and that "something set it". Both were wrong, and from the same mistake: `SELECT setting || unit`
> concatenates `"524288"` with `"8kB"` into `"5242888kB"`, which reads as 5 GB. It is
> 524288 × 8kB = **4 GB**, and its source is `default` — nobody chose it. The substance survives
> (4 GB is still fiction under a 3 GB cap) but the number and the story did not. `pg_settings` has
> `setting`, `unit` and `source` as separate columns for exactly this reason; read them separately.

---

## Change 1 of 2 — cap the WSL VM

Copy to `%USERPROFILE%\.wslconfig`, then `wsl --shutdown`. Docker Desktop restarts its distro on
demand; the named volumes (`ibms-app_db-data`, `ibms-app_db-test-data`) live in the VHDX and are
untouched.

```ini
[wsl2]
# 3 GB, against an uncapped default that Windows 11 sets to ~50% of RAM (~4 GB here — and
# vmmemWSL was measured at 3941 MB, consistent with having grown into it).
#
# Enough for what actually runs in here: two Postgres containers whose shared_buffers total
# 256 MB. The rest is OS page cache for the data files. db-test is 6.09 GB, so it was never
# going to fit in page cache at 3 GB OR at 4 GB — the marginal cache loss is real but small.
#
# THE TRADE: a lower cap means Postgres keeps less of that 6.09 GB cached and does more disk
# I/O, so the e2e suite runs slower. A higher cap means Windows swaps, which is what drove
# FreePhysicalMemory to 21 MB and stopped the test runner from starting at all. The second
# failure is much worse than the first, so this errs low.
#
# If the suite is measurably slower afterwards and the machine still has headroom, 4GB is the
# next step — change one thing and re-measure, not both.
memory=3GB

# 4 of 8 logical cores. WSL only runs Postgres, and the api e2e suite is SERIAL
# (`fileParallelism: false`), so there is one active connection at a time. The test runner,
# Next.js and VS Code all run on the WINDOWS side, where today WSL is free to contend for all
# 8 with them. This reserves half.
processors=4

# swap: left at the default deliberately. `swap=0` would make Postgres OOM-kill under the
# tighter cap instead of degrading — trading a slow suite for a broken one.

[experimental]
# Returns freed memory to Windows instead of holding the high-water mark, which is the specific
# behaviour that left vmmemWSL at 3941 MB long after the work finished. WSL 2.0+; this machine
# is 2.1.5.0. "gradual" rather than "dropcache", because dropcache discards the page cache
# outright and this workload is precisely the one that wants it.
autoMemoryReclaim=gradual
```

## Change 2 of 2 — tell the planner the truth about the cache

`effective_cache_size` is what the query planner BELIEVES about cache available to it. It is
currently Postgres's stock **4 GB default**, which already overstates this machine (WSL's default
cap is ~4 GB for the whole VM, shared by two instances) and becomes fiction under a 3 GB cap.

An overstated value makes the planner treat random I/O as cheap and prefer index scans over
sequential ones. On a 6 GB test database that is the wrong choice, and it goes wrong **quietly** —
a worse plan, not an error. This is the same category as every other defect this month: a
component reasoning correctly from a false premise.

**Set it to 1 GB per instance.** The arithmetic, under a 3 GB VM:

```
  3072 MB   VM cap
-  256 MB   shared_buffers, 128 MB x 2 instances
-  ~500 MB  WSL kernel + Docker daemon overhead
= ~2300 MB  page cache available, shared by TWO instances
→ ~1150 MB each  →  1GB, rounded down
```

Add to **both** the `db` and `db-test` services in `docker-compose.yml`:

```yaml
    # Matches the 3 GB WSL cap in docs/host-memory-tuning.md. The 4 GB default assumes
    # cache this VM does not have, and an overstated value makes the planner prefer
    # index scans that then miss. Recompute this if the WSL memory cap changes.
    command:
      - postgres
      - -c
      - effective_cache_size=1GB
```

Then `docker compose up -d db db-test` to recreate the containers. Data survives — it is in the
named volumes, not the containers.

**Verify both changes landed:**

```bash
# the VM cap
wsl -d docker-desktop -e sh -c 'free -m | head -2'          # total should be ~3000
# the planner's belief, read as separate columns, not concatenated
docker exec ibms-app-db-test-1 psql -U ibms -d ibms_test \
  -c "SELECT name, setting, unit, source FROM pg_settings WHERE name='effective_cache_size'"
```

---

## What is deliberately NOT here

- **Raising the pagefile.** The commit limit is already 31.84 GB against 8 GB of RAM; more
  pagefile buys more swapping, not more speed.
- **Pruning the other projects' Docker images** (13.2 GB reclaimable). Freeing them returns
  nothing to the Windows host without an elevated compaction of the 41 GB `docker_data.vhdx`,
  so it is cost without benefit unless that compaction is happening in the same sitting.
- **Anything about the desktop applications.** Measured, for the record, since it dwarfs
  everything above: one app was using **377.5% of one core** (nearly 4 of 8) and 3850 MB of
  commit. Closing it took commit from 98% to 82.8% and CPU from 100% to 37.8%, and is what let
  the 91-file suite complete. That is the owner's machine and the owner's call.
