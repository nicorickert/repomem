#!/bin/bash
# repomem-validate.sh — validate the repository's memory folder.
#
# Wired as a Kiro `agentSpawn` hook by `repomem setup --agent kiro`. It runs on
# agent start to surface any invalid memory entries early. The exit code is not
# used to block (agentSpawn hooks only add stdout to context), so a failure here
# is informational.
set -euo pipefail

npx -y repomem validate
