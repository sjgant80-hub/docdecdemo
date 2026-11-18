#!/usr/bin/env bash
# bench/pipeline.sh — everything after encode.mjs, in order, unattended. Each step is resumable (all work is cached).
set -e
cd "$(dirname "$0")"
log() { echo "[$(date +%H:%M:%S)] $*"; }
log "score (S2, S3) and reader phase 1 (S1/S2 ColBERT top-1, S4, the paraphrases) side by side"
node score.mjs > cache/score.log 2>&1 &
SCORE=$!
node read-jobs.mjs p1 2>&1 | grep -v -i warn
wait $SCORE; tail -3 cache/score.log
log "encode-extra (paraphrase vectors, the hyperbolic index)"
node encode-extra.mjs 2>&1 | grep -v -i warn
for round in 1 2 3 4; do
  log "export round $round"
  node export.mjs 2>&1 | grep -v -i warn | tee cache/export.log
  if grep -q "reader calls still wanted: 0 " cache/export.log; then break; fi
  log "filling the reader calls the measurement asked for"
  node read-jobs.mjs needs 2>&1 | grep -v -i warn | tail -2
done
log "latency on a quiet machine"
node latency.mjs 2>&1 | grep -v -i warn | tail -12
log "browser-runtime parity"
node parity-web.mjs 2>&1 | grep -v -i warn | tail -20
log "final export"
node export.mjs 2>&1 | grep -v -i warn
log "pipeline done"
