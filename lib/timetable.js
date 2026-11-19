const DAY_START = 9 * 60;            // 09:00
const DAY_END = 21 * 60;             // 21:00
const SLOT = 30;                     // 30분 단위
const SLOT_COUNT = (DAY_END - DAY_START) / SLOT;
const DAYS = ['월', '화', '수', '목', '금'];

function toMin(t) {
  const [h, m] = String(t).split(':').map(Number);
  return h * 60 + (m || 0);
}
function toStr(min) {
  return String(Math.floor(min / 60)).padStart(2, '0') + ':' + String(min % 60).padStart(2, '0');
}
function fmtMin(min) {
  const h = Math.floor(min / 60), m = min % 60;
  return (h ? h + '시간' : '') + (h && m ? ' ' : '') + (m ? m + '분' : '');
}
function slotLabel(i) {
  return toStr(DAY_START + i * SLOT);
}

// 수업이 걸치는 30분 칸 번호들
function slotsOf(startMin, endMin) {
  const out = [];
  for (let i = 0; i < SLOT_COUNT; i++) {
    const s = DAY_START + i * SLOT;
    if (s < endMin && s + SLOT > startMin) out.push(i);
  }
  return out;
}

// 내 시간표 격자: grid[칸][요일] = { entry, first } 또는 null
function buildMyGrid(entries) {
  const grid = Array.from({ length: SLOT_COUNT }, () => Array(5).fill(null));
  entries.forEach((e) => {
    const d = e.day_of_week - 1;
    if (d < 0 || d > 4) return;
    slotsOf(toMin(e.start_time), toMin(e.end_time)).forEach((s, idx) => {
      grid[s][d] = { entry: e, first: idx === 0 };
    });
  });
  return grid;
}

// 그룹 공통 공강 계산
function computeGroup(memberIds, entries, minSlots) {
  // 1) 사람별·요일별로 수업이 있는 칸 표시
  const busy = {};
  memberIds.forEach((id) => { busy[id] = Array.from({ length: 5 }, () => new Set()); });
  entries.forEach((e) => {
    const d = e.day_of_week - 1;
    if (d < 0 || d > 4 || !busy[e.user_id]) return;
    slotsOf(toMin(e.start_time), toMin(e.end_time)).forEach((s) => busy[e.user_id][d].add(s));
  });

  // 2) 칸마다 수업 중인 사람 수 집계
  const busyCount = Array.from({ length: SLOT_COUNT }, () => Array(5).fill(0));
  memberIds.forEach((id) => {
    for (let d = 0; d < 5; d++) busy[id][d].forEach((s) => { busyCount[s][d]++; });
  });

  // 3) 아무도 수업이 없는 칸이 minSlots개 이상 이어지는 구간만 추출
  const inRun = Array.from({ length: SLOT_COUNT }, () => Array(5).fill(false));
  const runs = [];
  for (let d = 0; d < 5; d++) {
    let s = 0;
    while (s < SLOT_COUNT) {
      if (busyCount[s][d] === 0) {
        let e = s;
        while (e < SLOT_COUNT && busyCount[e][d] === 0) e++;
        if (e - s >= minSlots) {
          for (let k = s; k < e; k++) inRun[k][d] = true;
          runs.push({
            day: d,
            start: toStr(DAY_START + s * SLOT),
            end: toStr(DAY_START + e * SLOT),
            minutes: (e - s) * SLOT,
          });
        }
        s = e;
      } else {
        s++;
      }
    }
  }
  const best = runs.reduce((a, r) => (!a || r.minutes > a.minutes ? r : a), null);
  return { busyCount, inRun, runs, best };
}

module.exports = { DAY_START, DAY_END, SLOT, SLOT_COUNT, DAYS, toMin, toStr, fmtMin, slotLabel, buildMyGrid, computeGroup };
