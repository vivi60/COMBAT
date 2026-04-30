// ═══════════════════════════════════════════
// 전역 변수
// ═══════════════════════════════════════════
let myProfile = { name: "", type: "", side: "" };
let currentRoomId = "";
let _lastMotionId = null;
let _pendingAction2v2 = null;
let _pendingRoomId = "";
let _currentRoomData = null; // 최신 룸 데이터 캐시 (타겟 버튼 비활성화용)
let _timerInterval = null;   // 클라이언트 타이머 인터벌
let _lastPhase = null;       // 페이즈 변경 감지용

// ═══════════════════════════════════════════
// 유틸
// ═══════════════════════════════════════════
function roll(max) { return Math.floor(Math.random() * max) + 1; }
function rollAttack()  { return roll(15) + 5; }
function rollDefense() { return roll(15) + 5; }
function teamOf(slot)  { return slot ? slot.split('_')[0] : ''; }
function is2v2Side(s)  { return s && s.includes('_'); }

// ═══════════════════════════════════════════
// [1] 캐릭터 선택
// ═══════════════════════════════════════════
function selectCharacter(name, isAdmin, num) {
    myProfile.name   = name;
    myProfile.charId = `${name}|${num || 1}`;
    myProfile.type   = isAdmin ? "ADMIN" : "PLAYER";
    const profileDisplay = document.getElementById('user-profile-display');
    if (profileDisplay) {
        profileDisplay.classList.remove('hidden');
        document.getElementById('my-char-name').innerText = name;
        const imgSrc = isAdmin ? "image/관리자.png" : `image/${name.split(' ')[0]}${num||1}.png`;
        document.getElementById('my-char-img').innerHTML = `<img src="${imgSrc}" class="w-full h-full object-cover">`;
    }
    document.getElementById('character-selection').classList.add('hidden');
    document.getElementById('game-lobby').classList.remove('hidden');
}

// ═══════════════════════════════════════════
// [2] 방 만들기
// ═══════════════════════════════════════════
async function createRoom(type, title) {
    const newRoomId = title + "_" + Math.floor(Math.random() * 1000);
    const roomRef   = window.dbUtils.doc(window.db, "rooms", newRoomId);
    const base = {
        roomType: type, roomName: title, status: "waiting",
        dice_left: 0, dice_right: 0, playersCount: 0, currentRound: 1,
        isDetermined: false, firstSide: "", turnFirst: "", phase: "dice",
        ready_left: false, ready_right: false,
        lastMotionId: 0, lastMotions: [], messages: []
    };
    if (type === '1vs1') {
        Object.assign(base, { hp_left:100, hp_right:100, name_left:"", name_right:"", action_first:"", action_second:"" });
    } else {
        Object.assign(base, {
            name_left_a:"", name_left_b:"", name_right_a:"", name_right_b:"",
            hp_left_a:100, hp_left_b:100, hp_right_a:100, hp_right_b:100,
            action_left_a:"", action_left_b:"", action_right_a:"", action_right_b:"",
            target_left_a:"", target_left_b:"", target_right_a:"", target_right_b:"",
            left_done:false, right_done:false
        });
    }
    await window.dbUtils.setDoc(roomRef, base);
    const firstSlot = myProfile.type === "ADMIN" ? "admin" : (type === '1vs1' ? "left" : "left_a");
    joinRoom(newRoomId, firstSlot);
}

// ═══════════════════════════════════════════
// [3] 팀 선택 모달 (2vs2)
// ═══════════════════════════════════════════
function openTeamSelectModal(roomId, roomName) {
    _pendingRoomId = roomId;
    const el = document.getElementById('team-select-room-info');
    if (el) el.innerText = `방: ${roomName}`;
    const modal = document.getElementById('team-select-modal');
    modal.style.display = 'flex';
}
function closeTeamSelectModal() {
    const modal = document.getElementById('team-select-modal');
    modal.style.display = 'none';
    // _pendingRoomId는 confirmTeamSelect에서만 초기화
}
async function confirmTeamSelect(teamSide) {
    if (!_pendingRoomId) return;
    const roomId = _pendingRoomId;
    _pendingRoomId = "";
    closeTeamSelectModal();
    const snap = await window.dbUtils.getDoc(window.dbUtils.doc(window.db, "rooms", roomId));
    if (!snap.exists()) { alert("방을 찾을 수 없습니다."); return; }
    const sd = snap.data();
    const slots = teamSide === 'left' ? ['left_a','left_b'] : ['right_a','right_b'];
    const emptySlot = slots.find(s => !sd[`name_${s}`]?.trim());
    if (!emptySlot) { alert(`${teamSide==='left'?'왼팀':'오른팀'}이 이미 가득 찼습니다!`); return; }
    joinRoom(roomId, emptySlot);
}

// ═══════════════════════════════════════════
// [4] 방 입장
// ═══════════════════════════════════════════
async function joinRoom(roomId, side) {
    currentRoomId = roomId; _lastMotionId = null; _pendingAction2v2 = null;
    _lastNoticeCount = 0; _lastChatCount = 0; _currentChatTab = 'notice';
    const roomRef = window.dbUtils.doc(window.db, "rooms", roomId);
    try {
        let updateData = {};
        if (myProfile.type === "ADMIN" || side === "admin") {
            myProfile.side = "admin";
            updateData = { messages: window.dbUtils.arrayUnion({ sender:"시스템", text:"관리자 님이 입장했습니다.", timestamp:Date.now() }) };
        } else {
            myProfile.side = side;
            const charSnap = await window.dbUtils.getDoc(window.dbUtils.doc(window.db, "characters", myProfile.name));
            const startingHp = (charSnap.exists() && charSnap.data().maxHp !== undefined) ? charSnap.data().maxHp : 100;
            updateData = {
                playersCount: window.dbUtils.increment(1),
                [`name_${side}`]: myProfile.charId,
                [`hp_${side}`]: startingHp,
                [`start_hp_${side}`]: startingHp,
                messages: window.dbUtils.arrayUnion({ sender:"시스템", text:`${myProfile.name} 님이 입장했습니다.`, timestamp:Date.now() })
            };
        }
        await window.dbUtils.updateDoc(roomRef, updateData);
    } catch(e) { console.error("joinRoom 오류:", e); }

    document.getElementById('ready-overlay')?.classList.add('hidden');
    document.getElementById('result-overlay')?.classList.add('hidden');
    document.getElementById('game-lobby').classList.add('hidden');
    document.getElementById('user-profile-display').classList.add('hidden');
    document.getElementById('battle-screen').classList.remove('hidden');
    startRealtimeUpdate(roomId);
}

// ═══════════════════════════════════════════
// [5] 다이스 굴리기
// ═══════════════════════════════════════════
async function rollDice(side) {
    // 1vs1 팀 다이스 (side: 'left' or 'right')
    const myTeam = is2v2Side(myProfile.side) ? teamOf(myProfile.side) : myProfile.side;
    if (myTeam !== side && myProfile.type !== "ADMIN") { alert("본인 팀의 다이스만 굴릴 수 있습니다!"); return; }
    if (!currentRoomId) return;
    const roomRef = window.dbUtils.doc(window.db, "rooms", currentRoomId);
    const snap = await window.dbUtils.getDoc(roomRef);
    if (!snap.exists()) return;
    const d = snap.data();
    if (d.status !== "fighting") { alert("전투 시작 후 굴릴 수 있습니다!"); return; }
    if (d[`dice_${side}`] > 0)   { alert("이미 굴렸습니다!"); return; }
    if (d.phase !== "dice") return;
    document.getElementById(`dice-${side}`)?.classList.add('dice-rolling');
    const result = Math.floor(Math.random() * 100) + 1;
    setTimeout(async () => { await window.dbUtils.updateDoc(roomRef, { [`dice_${side}`]: result }); }, 500);
}

async function rollDice2v2(slot) {
    // 2vs2 개인 주사위 (slot: 'left_a', 'left_b', 'right_a', 'right_b')
    if (myProfile.side !== slot && myProfile.type !== "ADMIN") { alert("본인 주사위만 굴릴 수 있습니다!"); return; }
    if (!currentRoomId) return;
    const roomRef = window.dbUtils.doc(window.db, "rooms", currentRoomId);
    const snap = await window.dbUtils.getDoc(roomRef);
    if (!snap.exists()) return;
    const d = snap.data();
    if (d.status !== "fighting") { alert("전투 시작 후 굴릴 수 있습니다!"); return; }
    if (d[`dice_${slot}`] > 0)   { alert("이미 굴렸습니다!"); return; }
    if (d.phase !== "dice") return;
    document.getElementById(`dice-${slot}`)?.classList.add('dice-rolling');
    const result = Math.floor(Math.random() * 100) + 1;
    setTimeout(async () => {
        await window.dbUtils.updateDoc(roomRef, { [`dice_${slot}`]: result });
    }, 500);
}

// ═══════════════════════════════════════════
// [레디] 1vs1
// ═══════════════════════════════════════════
async function toggleReady(side) {
    if (myProfile.side !== side || !currentRoomId) return;
    const roomRef = window.dbUtils.doc(window.db, "rooms", currentRoomId);
    const snap = await window.dbUtils.getDoc(roomRef);
    if (!snap.exists()) return;
    await window.dbUtils.updateDoc(roomRef, { [`ready_${side}`]: !snap.data()[`ready_${side}`] });
}

// ═══════════════════════════════════════════
// [레디] 2vs2 - 개인별
// ═══════════════════════════════════════════
async function toggleReady2v2(slot) {
    // slot: 'left_a', 'left_b', 'right_a', 'right_b'
    if (myProfile.side !== slot || !currentRoomId) return;
    const roomRef = window.dbUtils.doc(window.db, "rooms", currentRoomId);
    const snap = await window.dbUtils.getDoc(roomRef);
    if (!snap.exists()) return;
    const cur = snap.data()[`ready_${slot}`] || false;
    // 팀 전체 레디 여부도 동시 업데이트
    const teamSide = teamOf(slot);
    const partnerSlot = slot.endsWith('_a') ? slot.replace('_a','_b') : slot.replace('_b','_a');
    const partnerReady = snap.data()[`ready_${partnerSlot}`] || false;
    const newVal = !cur;
    const teamReady = newVal && partnerReady;
    await window.dbUtils.updateDoc(roomRef, {
        [`ready_${slot}`]: newVal,
        [`ready_${teamSide}`]: teamReady
    });
}

// ═══════════════════════════════════════════
// [6] 선공 판정
// ═══════════════════════════════════════════
async function determineTurnOrder(data) {
    if (data.isDetermined) return;
    let leftScore, rightScore;
    if (data.roomType === '2vs2') {
        leftScore  = (data.dice_left_a||0)  + (data.dice_left_b||0);
        rightScore = (data.dice_right_a||0) + (data.dice_right_b||0);
    } else {
        leftScore  = data.dice_left  || 0;
        rightScore = data.dice_right || 0;
    }
    const first = leftScore >= rightScore ? "left" : "right";
    const roomRef = window.dbUtils.doc(window.db, "rooms", currentRoomId);
    const upd = {
        isDetermined:true, firstSide:first, turnFirst:first, phase:"turn_a",
        subTurn: 1, origRoundFirst: first,
        turnDeadline: Date.now() + 300000,
        messages: window.dbUtils.arrayUnion({ sender:"시스템", text:`🎲 ${leftScore} vs ${rightScore} → ${first==='left'?'왼팀':'오른팀'} 선공!`, timestamp:Date.now() })
    };
    if (data.roomType === '2vs2') {
        Object.assign(upd, { action_left_a:"",action_left_b:"",action_right_a:"",action_right_b:"", target_left_a:"",target_left_b:"",target_right_a:"",target_right_b:"", left_done:false, right_done:false });
    } else { upd.action_first=""; upd.action_second=""; }
    await window.dbUtils.updateDoc(roomRef, upd);
}

// ═══════════════════════════════════════════
// [전투] 1vs1 행동 선택
// ═══════════════════════════════════════════
async function selectAction(action) {
    if (!currentRoomId) return;
    const side = myProfile.side;
    if (side !== 'left' && side !== 'right') return;
    const roomRef = window.dbUtils.doc(window.db, "rooms", currentRoomId);
    let shouldResolve = false, resolveData = null;
    try {
        await window.dbUtils.runTransaction(window.db, async (tx) => {
            const snap = await tx.get(roomRef);
            if (!snap.exists()) throw new Error("방 없음");
            const d = snap.data();
            if (d.status !== 'fighting') throw new Error("전투 중 아님");
            if (!['turn_a','turn_b'].includes(d.phase)) throw new Error("페이즈 오류");
            if (action === '도주' && (d.currentRound||1) < 3) throw new Error("도주_불가");
            if (d.turnFirst !== side) throw new Error("상대팀_차례");
            // turn_a에선 action_first, turn_b에선 action_second가 이미 있으면 중복
            const alreadyDone = d.phase === 'turn_a' ? !!d.action_first : !!d.action_second;
            if (alreadyDone) throw new Error("이미_선택");

            const update = d.phase === 'turn_a' ? { action_first: action } : { action_second: action };

            if (d.phase === 'turn_a') {
                const secondSide = side === 'left' ? 'right' : 'left';
                update.phase = 'turn_b';
                update.turnFirst = secondSide;
                update.turnDeadline = Date.now() + 300000;
                update.messages = window.dbUtils.arrayUnion({
                    sender:"시스템",
                    text:`${(d[`name_${side}`]||'').split('|')[0]} 행동 완료! ↩️ 후공 차례`,
                    timestamp:Date.now()
                });
            } else {
                shouldResolve = true;
                resolveData = { ...d, action_second: action };
            }
            tx.update(roomRef, update);
        });
    } catch(e) {
        if (e.message==="도주_불가")   { alert("도주는 3라운드부터 가능합니다!"); return; }
        if (e.message==="이미_선택")   { alert("이미 행동을 선택했습니다!"); return; }
        if (e.message==="상대팀_차례") { alert("아직 내 차례가 아닙니다!"); return; }
        console.error("selectAction 오류:", e); return;
    }
    const btns = document.getElementById(`btns-${side}`);
    if (btns) btns.querySelectorAll('button').forEach(b => {
        b.disabled=true;
        b.style.opacity=b.textContent.trim()===action?'1':'0.3';
        b.style.outline=b.textContent.trim()===action?'3px solid white':'';
    });
    if (shouldResolve && resolveData) await resolveTurn(resolveData, roomRef);
}

// ═══════════════════════════════════════════
// [전투] 2vs2 행동 선택
// ═══════════════════════════════════════════
async function selectAction2v2(slot, action) {
    if (!currentRoomId || myProfile.side !== slot) return;

    // 먼저 두 패널 모두 닫기
    showPanel(`atk-targets-${slot}`, false);
    showPanel(`def-targets-${slot}`, false);
    _pendingAction2v2 = null;

    if (action === '도주') {
        const snap = await window.dbUtils.getDoc(window.dbUtils.doc(window.db, "rooms", currentRoomId));
        if (snap.exists() && (snap.data().currentRound||1) < 3) { alert("도주는 3라운드부터 가능합니다!"); return; }
        await commitAction2v2(slot, action, "");
        return;
    }
    if (action === '회피') {
        await commitAction2v2(slot, action, "");
        return;
    }
    if (action === '공격') {
        // 공격 타겟 이름 업데이트
        const shortMap = {'left_a':'la','left_b':'lb','right_a':'ra','right_b':'rb'};
        const ms = shortMap[slot];
        const enemies = teamOf(slot)==='left'
            ? [['ra','right_a'],['rb','right_b']]
            : [['la','left_a'],['lb','left_b']];
        enemies.forEach(([eshort, eslot]) => {
            const nameEl = document.getElementById(`name-${eslot}`);
            const tEl = document.getElementById(`tname-${eshort}-${ms}`);
            if (!tEl) return;
            const btn = tEl.parentElement;
            const eHp = _currentRoomData ? (_currentRoomData[`hp_${eslot}`]??100) : 100;
            const dead = eHp <= 0;
            tEl.innerText = (nameEl ? nameEl.innerText : eslot) + (dead ? ' (사망)' : '');
            btn.disabled = dead;
            btn.style.opacity = dead ? '0.35' : '1';
            btn.style.background = dead ? '#4b5563' : '#b45309';
            btn.style.cursor = dead ? 'not-allowed' : 'pointer';
        });
        _pendingAction2v2 = '공격';
        showPanel(`atk-targets-${slot}`, true);
        return;
    }
    if (action === '방어') {
        // 방어 대상 이름 업데이트
        const shortMap = {'left_a':'la','left_b':'lb','right_a':'ra','right_b':'rb'};
        const ms = shortMap[slot];
        const allies = teamOf(slot)==='left'
            ? [['la','left_a'], ['lb','left_b']]
            : [['ra','right_a'], ['rb','right_b']];
        allies.forEach(([ashort, aslot]) => {
            const nameEl = document.getElementById(`name-${aslot}`);
            const tEl = document.getElementById(`dname-${ashort}-${ms}`);
            if (!tEl) return;
            const btn = tEl.parentElement;
            const aHp = _currentRoomData ? (_currentRoomData[`hp_${aslot}`]??100) : 100;
            const dead = aHp <= 0;
            tEl.innerText = dead ? `${nameEl?.innerText||aslot}(사망)` : (aslot===slot ? `${nameEl?.innerText||aslot}(나)` : (nameEl?.innerText||aslot));
            btn.disabled = dead;
            btn.style.opacity = dead ? '0.35' : '1';
            btn.style.background = dead ? '#4b5563' : '#1d4ed8';
            btn.style.cursor = dead ? 'not-allowed' : 'pointer';
        });
        _pendingAction2v2 = '방어';
        showPanel(`def-targets-${slot}`, true);
        return;
    }
}

function showPanel(panelId, show) {
    const panel = document.getElementById(panelId);
    if (!panel) return;
    panel.classList.toggle('hidden', !show);
}

function showTargetPanel(slot, show) {
    // legacy — 이제 showPanel 직접 사용
    showPanel(`atk-targets-${slot}`, show);
    if (show) {
        const shortMap = {'left_a':'la','left_b':'lb','right_a':'ra','right_b':'rb'};
        const ms = shortMap[slot];
        const enemies = teamOf(slot)==='left' ? [['ra','right_a'],['rb','right_b']] : [['la','left_a'],['lb','left_b']];
        enemies.forEach(([eshort, eslot]) => {
            const nameEl = document.getElementById(`name-${eslot}`);
            const tEl = document.getElementById(`tname-${eshort}-${ms}`);
            if (tEl && nameEl) tEl.innerText = nameEl.innerText || eslot;
        });
    }
}

async function selectTarget2v2(targetSlot) {
    if (_pendingAction2v2 !== '공격') return;
    const slot = myProfile.side;
    showPanel(`atk-targets-${slot}`, false);
    _pendingAction2v2 = null;
    await commitAction2v2(slot, '공격', targetSlot);
}

async function selectDefendTarget2v2(targetSlot) {
    if (_pendingAction2v2 !== '방어') return;
    const slot = myProfile.side;
    showPanel(`def-targets-${slot}`, false);
    _pendingAction2v2 = null;
    await commitAction2v2(slot, '방어', targetSlot);
}

async function commitAction2v2(slot, action, target) {
    const roomRef = window.dbUtils.doc(window.db, "rooms", currentRoomId);
    let shouldResolve = false, resolveData = null;
    const myTeam = teamOf(slot);
    try {
        await window.dbUtils.runTransaction(window.db, async (tx) => {
            const snap = await tx.get(roomRef);
            if (!snap.exists()) throw new Error("방 없음");
            const d = snap.data();
            if (d.status !== 'fighting') throw new Error("전투 중 아님");
            if (!['turn_a','turn_b'].includes(d.phase)) throw new Error("페이즈 오류");
            if (d[`action_${slot}`]) throw new Error("이미_선택");
            if (myTeam !== d.turnFirst) throw new Error("상대팀_차례");

            const partnerSlot = slot.endsWith('_a') ? slot.replace('_a','_b') : slot.replace('_b','_a');
            const partnerHp   = d[`hp_${partnerSlot}`] ?? 100;
            // 파트너가 행동했거나 사망(HP 0)이면 완료로 간주
            const partnerDone = !!d[`action_${partnerSlot}`] || partnerHp <= 0;
            const update = { [`action_${slot}`]:action, [`target_${slot}`]:target };

            if (partnerDone) {
                // 내 팀 두 명 모두 완료
                update[`${myTeam}_done`] = true;
                update.messages = window.dbUtils.arrayUnion({
                    sender:"시스템",
                    text:`${myTeam==='left'?'왼팀':'오른팀'} 행동 완료!`,
                    timestamp:Date.now()
                });

                if (d.phase === 'turn_a') {
                    // turn_a: 선공팀 완료 → 후공팀 차례로 넘김 (resolve 아님)
                    const secondTeam = myTeam==='left'?'right':'left';
                    update.phase = 'turn_b';
                    update.turnFirst = secondTeam;
                    update.turnDeadline = Date.now() + 300000;
                    update.messages = window.dbUtils.arrayUnion({
                        sender:"시스템",
                        text:`${myTeam==='left'?'왼팀':'오른팀'} 행동 완료! ↩️ ${secondTeam==='left'?'왼팀':'오른팀'} 차례`,
                        timestamp:Date.now()
                    });
                } else {
                    // turn_b: 후공팀 완료 → 결산
                    shouldResolve = true;
                    resolveData = { ...d, [`action_${slot}`]:action, [`target_${slot}`]:target };
                }
            }
            tx.update(roomRef, update);
        });
    } catch(e) {
        if (e.message==="이미_선택")   { alert("이미 행동을 선택했습니다!"); return; }
        if (e.message==="상대팀_차례") { alert("아직 내 팀 차례가 아닙니다!"); return; }
        console.error("commitAction2v2 오류:", e); return;
    }
    const btns = document.getElementById(`btns-${slot}`);
    if (btns) btns.querySelectorAll('button').forEach(b => {
        b.disabled=true;
        b.style.opacity=b.textContent.trim()===action?'1':'0.3';
        b.style.outline=b.textContent.trim()===action?'3px solid white':'';
    });
    if (shouldResolve && resolveData) await resolveTurn2v2(resolveData, roomRef);
}

// ═══════════════════════════════════════════
// [전투] 1vs1 턴 결산
// ═══════════════════════════════════════════
async function resolveTurn(data, roomRef) {
    // turn_b 종료 시 호출. data.firstSide = 원래 선공, data.turnFirst = 후공(현재)
    // action_first: turn_a에서 선공이 선택한 행동, turn_b에서 후공이 선택한 행동 → 각각 덮어쓰지 않고 별도 저장 필요
    // 실제로는 turn_a에서 action_first에 선공행동 저장, turn_b에서 action_second에 후공행동 저장하도록 수정
    // → 이미 이전 로직에서 action_first만 써버렸으므로, 선공행동=data.action_first_stored, 후공=data.action_first(현재)
    // 더 명확하게: turn_a 저장 → action_turn_a, turn_b 저장 → action_first(현재 덮어씀 방지 위해 action_second로)
    // 현재 코드는 두 turn 모두 action_first를 쓰므로 충돌. 1v1 selectAction을 turn_a → action_first, turn_b → action_second로 수정

    const origFirst  = data.firstSide || data.turnFirst;
    const origSecond = origFirst === 'left' ? 'right' : 'left';
    const aFirst  = data.action_first;   // 선공(turn_a)의 행동
    const aSecond = data.action_second;  // 후공(turn_b)의 행동
    const nFirst  = (data[`name_${origFirst}`]||'').split('|')[0];
    const nSecond = (data[`name_${origSecond}`]||'').split('|')[0];
    const round = data.currentRound || 1;
    const ts = Date.now();
    let hpFirst  = data[`hp_${origFirst}`]  ?? 100;
    let hpSecond = data[`hp_${origSecond}`] ?? 100;
    const logs = [], motions = [], icon = {'공격':'⚔️','방어':'🛡️','회피':'💨','도주':'🏃'};

    logs.push(`${icon[aFirst]||''} ${nFirst}의 행동: ${aFirst||'없음'}`);
    logs.push(`${icon[aSecond]||''} ${nSecond}의 행동: ${aSecond||'없음'}`);

    const effectiveA = aFirst || '';
    const effectiveB = aSecond || '';

    if (effectiveA==='공격'&&effectiveB==='공격') {
        const atk=rollAttack(); hpSecond=Math.max(0,hpSecond-atk);
        motions.push({side:origFirst,anim:'attack'},{side:origSecond,anim:'hit',popup:`-${atk}`,popupType:'damage'});
        logs.push(`${nFirst} 공격 ${atk} → ${nSecond} -${atk}HP`);
        if(hpSecond>0){const atk2=rollAttack();hpFirst=Math.max(0,hpFirst-atk2);motions.push({side:origSecond,anim:'attack'},{side:origFirst,anim:'hit',popup:`-${atk2}`,popupType:'damage'});logs.push(`${nSecond} 반격 ${atk2} → ${nFirst} -${atk2}HP`);}
        else logs.push(`${nSecond} 쓰러져 반격 불가!`);
    } else if (effectiveA==='공격'&&effectiveB==='방어') {
        const atk=rollAttack(),def=rollDefense(),dmg=Math.max(0,atk-def);hpSecond=Math.max(0,hpSecond-dmg);
        motions.push({side:origFirst,anim:'attack'},{side:origSecond,anim:'defend',popup:dmg>0?`-${dmg}`:'막음!',popupType:dmg>0?'damage':'defend'});
        logs.push(dmg>0?`공격 ${atk} - 방어 ${def} = ${dmg} 데미지`:`완전히 막아냈습니다!`);
    } else if (effectiveA==='방어'&&effectiveB==='공격') {
        const atk=rollAttack(),def=rollDefense(),dmg=Math.max(0,atk-def);hpFirst=Math.max(0,hpFirst-dmg);
        motions.push({side:origSecond,anim:'attack'},{side:origFirst,anim:'defend',popup:dmg>0?`-${dmg}`:'막음!',popupType:dmg>0?'damage':'defend'});
        logs.push(dmg>0?`공격 ${atk} - 방어 ${def} = ${dmg} 데미지`:`완전히 막아냈습니다!`);
    } else if (effectiveA==='공격'&&effectiveB==='회피') {
        const atk=rollAttack(),dodged=Math.random()<0.5;
        motions.push({side:origFirst,anim:'attack'},{side:origSecond,anim:'dodge',popup:dodged?'회피!':'실패!',popupType:dodged?'miss':'damage'});
        if(dodged)logs.push(`${nSecond} 회피 성공!`);else{hpSecond=Math.max(0,hpSecond-atk);logs.push(`회피 실패! -${atk}HP`);}
    } else if (effectiveA==='회피'&&effectiveB==='공격') {
        const atk=rollAttack(),dodged=Math.random()<0.5;
        motions.push({side:origSecond,anim:'attack'},{side:origFirst,anim:'dodge',popup:dodged?'회피!':'실패!',popupType:dodged?'miss':'damage'});
        if(dodged)logs.push(`${nFirst} 회피 성공!`);else{hpFirst=Math.max(0,hpFirst-atk);logs.push(`회피 실패! -${atk}HP`);}
    } else if (effectiveA==='공격'&&effectiveB==='도주') {
        const atk=rollAttack(),esc=Math.random()<0.5;
        motions.push({side:origSecond,anim:'flee',popup:esc?'도주!':'실패!',popupType:'flee'});
        if(esc){hpSecond=0;logs.push(`${nSecond} 도주 성공!`);}else{motions.push({side:origFirst,anim:'attack'},{side:origSecond,anim:'hit',popup:`-${atk}`,popupType:'damage'});hpSecond=Math.max(0,hpSecond-atk);logs.push(`도주 실패! -${atk}HP`);}
    } else if (effectiveA==='도주'&&effectiveB==='공격') {
        const atk=rollAttack(),esc=Math.random()<0.5;
        motions.push({side:origFirst,anim:'flee',popup:esc?'도주!':'실패!',popupType:'flee'});
        if(esc){hpFirst=0;logs.push(`${nFirst} 도주 성공!`);}else{motions.push({side:origSecond,anim:'attack'},{side:origFirst,anim:'hit',popup:`-${atk}`,popupType:'damage'});hpFirst=Math.max(0,hpFirst-atk);logs.push(`도주 실패! -${atk}HP`);}
    } else if (effectiveA==='도주'&&effectiveB==='도주') {
        const eA=Math.random()<0.5,eB=Math.random()<0.5;
        motions.push({side:origFirst,anim:'flee',popup:eA?'도주!':'실패!',popupType:'flee'},{side:origSecond,anim:'flee',popup:eB?'도주!':'실패!',popupType:'flee'});
        if(eA)hpFirst=0;if(eB)hpSecond=0;logs.push(`${nFirst} 도주 ${eA?'성공':'실패'} / ${nSecond} 도주 ${eB?'성공':'실패'}`);
    } else if (effectiveA==='도주') {
        const esc=Math.random()<0.5;motions.push({side:origFirst,anim:'flee',popup:esc?'도주!':'실패!',popupType:'flee'});
        if(effectiveB==='회피')motions.push({side:origSecond,anim:'dodge'});else if(effectiveB==='방어')motions.push({side:origSecond,anim:'defend'});
        if(esc){hpFirst=0;logs.push(`${nFirst} 도주 성공!`);}else logs.push(`${nFirst} 도주 실패! 피해 없음.`);
    } else if (effectiveB==='도주') {
        const esc=Math.random()<0.5;motions.push({side:origSecond,anim:'flee',popup:esc?'도주!':'실패!',popupType:'flee'});
        if(effectiveA==='회피')motions.push({side:origFirst,anim:'dodge'});else if(effectiveA==='방어')motions.push({side:origFirst,anim:'defend'});
        if(esc){hpSecond=0;logs.push(`${nSecond} 도주 성공!`);}else logs.push(`${nSecond} 도주 실패! 피해 없음.`);
    } else {
        logs.push(`서로 맞붙지 않아 피해가 없습니다.`);
    }

    const hp_left  = origFirst==='left' ? hpFirst : hpSecond;
    const hp_right = origFirst==='left' ? hpSecond : hpFirst;
    const nL = (data.name_left||'').split('|')[0], nR = (data.name_right||'').split('|')[0];
    const motionId = ts;
    const isGameOver = (hp_left<=0||hp_right<=0)||(round>=5);
    let resultMsg = [];
    logs.forEach((l,i)=>resultMsg.push({sender:"시스템",text:l,timestamp:ts+i}));

    if (isGameOver) {
        let endText="";
        if(hp_left<=0&&hp_right<=0){endText="⚡ 무승부!";}
        else if(hp_left<=0){endText=`🏆 ${nR} 승리!`;motions.push({side:'right',popup:'승리!',popupType:'win'});}
        else if(hp_right<=0){endText=`🏆 ${nL} 승리!`;motions.push({side:'left',popup:'승리!',popupType:'win'});}
        else if(hp_left>hp_right){endText=`🏆 5라운드 — ${nL} 승리!`;motions.push({side:'left',popup:'승리!',popupType:'win'});}
        else if(hp_right>hp_left){endText=`🏆 5라운드 — ${nR} 승리!`;motions.push({side:'right',popup:'승리!',popupType:'win'});}
        else{endText=`⚡ 5라운드 — 무승부!`;}
        resultMsg.push({sender:"시스템",text:endText,timestamp:ts+logs.length+1});
        await window.dbUtils.updateDoc(roomRef,{hp_left,hp_right,action_first:"",action_second:"",status:"ended",lastMotions:motions,lastMotionId:motionId,messages:window.dbUtils.arrayUnion(...resultMsg)});
    } else {
        const subTurn = data.subTurn || 1;
        if (subTurn === 1) {
            const newFirst = origFirst === 'left' ? 'right' : 'left';
            const newFirstName = (data[`name_${newFirst}`]||'').split('|')[0];
            resultMsg.push({sender:"시스템", text:`↩️ ${newFirstName}의 턴 시작!`, timestamp:ts+logs.length+1});
            const miniDeadline = Date.now() + 300000;
            await window.dbUtils.updateDoc(roomRef,{
                hp_left,hp_right, action_first:"", action_second:"",
                phase:"turn_a", subTurn:2,
                turnFirst:newFirst, firstSide:newFirst,
                turnDeadline:miniDeadline,
                lastMotions:motions, lastMotionId:motionId,
                messages:window.dbUtils.arrayUnion(...resultMsg)
            });
        } else {
            // 2번째 미니턴 끝 → 라운드 종료
            const nextRound=round+1;
            const origRoundFirst = data.origRoundFirst || origSecond;
            const nextRoundFirst = origRoundFirst === 'left' ? 'right' : 'left';
            resultMsg.push({sender:"시스템",text:`다음 라운드 준비 중...`,timestamp:ts+logs.length+1});
            const breakDeadline = Date.now() + 60000;
            await window.dbUtils.updateDoc(roomRef,{
                hp_left,hp_right, action_first:"", action_second:"",
                phase:"break", nextRound,
                nextFirst: nextRoundFirst,
                nextOrigRoundFirst: nextRoundFirst,
                turnFirst: nextRoundFirst, breakDeadline,
                lastMotions:motions, lastMotionId:motionId,
                messages:window.dbUtils.arrayUnion(...resultMsg)
            });
        }
    }
}


// ═══════════════════════════════════════════
// [전투] 2vs2 턴 결산 — 공격 합산, 방어 합산
// ═══════════════════════════════════════════
async function resolveTurn2v2(data, roomRef) {
    const slots = ['left_a','left_b','right_a','right_b'];
    const ts = Date.now(), round = data.currentRound || 1;
    const origFirst  = data.firstSide || data.turnFirst;
    const origSecond = origFirst === 'left' ? 'right' : 'left';
    const ordered = [`${origFirst}_a`,`${origFirst}_b`,`${origSecond}_a`,`${origSecond}_b`];

    let hp = {};
    slots.forEach(s => { hp[s] = data[`hp_${s}`] ?? 100; });

    const logs = [], motions = [];
    const icon = {'공격':'⚔️','방어':'🛡️','회피':'💨','도주':'🏃'};
    const name = s => (data[`name_${s}`]||'').split('|')[0] || s;

    // ─ 1단계: 도주 처리 (선공 순서대로)
    for (const s of ordered) {
        const act = data[`action_${s}`];
        if (act !== '도주') continue;
        if (hp[s] <= 0) continue;
        const esc = Math.random() < 0.5;
        motions.push({ side:s, anim:'flee', popup: esc?'도주!':'실패!', popupType:'flee' });
        if (esc) { hp[s] = 0; logs.push(`🏃 ${name(s)}: 도주 성공 — 전투 이탈`); }
        else logs.push(`🏃 ${name(s)}: 도주 실패`);
    }

    // ─ 2단계: 각 타겟별로 공격 합산 & 방어 합산 계산
    // 공격자 목록: action=공격, target=타겟슬롯, 살아있음
    const attackers = ordered.filter(s => data[`action_${s}`]==='공격' && data[`target_${s}`] && hp[s]>0);
    // 방어자 목록: action=방어, target=지키려는 슬롯 (자신 또는 팀원)
    const defenders = slots.filter(s => data[`action_${s}`]==='방어' && hp[s]>0);

    // 타겟별로 그룹화
    const attacksByTarget = {};
    attackers.forEach(atk => {
        const tgt = data[`target_${atk}`];
        if (!attacksByTarget[tgt]) attacksByTarget[tgt] = [];
        attacksByTarget[tgt].push(atk);
    });

    // 각 타겟에 대한 처리
    for (const tgt of slots) {
        const atkGroup = attacksByTarget[tgt] || [];
        if (atkGroup.length === 0) continue;
        if (hp[tgt] <= 0) {
            atkGroup.forEach(a => logs.push(`${icon['공격']} ${name(a)} → ${name(tgt)}: 이미 쓰러짐`));
            continue;
        }

        // 이 타겟을 회피 중인지
        const tgtAction = data[`action_${tgt}`];
        const tgtDefTarget = data[`target_${tgt}`]; // 방어 시 자기자신 지키면 tgt===tgt

        // 공격 합산
        let totalAtk = 0;
        const atkRolls = [];
        atkGroup.forEach(a => {
            const r = rollAttack();
            totalAtk += r;
            atkRolls.push(`${name(a)}:${r}`);
            motions.push({ side:a, anim:'attack' });
        });

        // 이 타겟을 방어하는 방어자들 (target이 tgt인 defender)
        const defGroup = defenders.filter(d => data[`target_${d}`] === tgt && hp[d] > 0);

        if (tgtAction === '회피') {
            // 회피: 타겟이 회피 선택 → 50% 성공
            const dodged = Math.random() < 0.5;
            motions.push({ side:tgt, anim:'dodge', popup: dodged?'회피!':'실패!', popupType: dodged?'miss':'damage' });
            if (dodged) {
                logs.push(`${icon['공격']} [공격합계 ${totalAtk}] → ${name(tgt)}: 회피 성공! (${atkRolls.join('+')})`);
            } else {
                hp[tgt] = Math.max(0, hp[tgt] - totalAtk);
                motions.push({ side:tgt, anim:'hit', popup:`-${totalAtk}`, popupType:'damage' });
                logs.push(`${icon['공격']} [공격합계 ${totalAtk}] → ${name(tgt)}: 회피 실패! -${totalAtk}HP (${atkRolls.join('+')})`);
                if(hp[tgt]<=0) logs.push(`💀 ${name(tgt)} 전투 불능!`);
            }
        } else if (defGroup.length > 0 || tgtAction === '방어' && tgtDefTarget === tgt) {
            // 방어: defGroup = 이 타겟을 지키는 방어자들
            // (타겟 자신이 방어했다면 자동으로 포함됨 — defGroup에 이미 들어있음)
            let totalDef = 0;
            const defRolls = [];
            defGroup.forEach(d => {
                const r = rollDefense();
                totalDef += r;
                defRolls.push(`${name(d)}:${r}`);
                motions.push({ side:d, anim:'defend' });
            });
            const dmg = Math.max(0, totalAtk - totalDef);
            hp[tgt] = Math.max(0, hp[tgt] - dmg);
            if (dmg > 0) {
                motions.push({ side:tgt, anim:'hit', popup:`-${dmg}`, popupType:'damage' });
                logs.push(`${icon['공격']} [공격 ${atkRolls.join('+')}=${totalAtk}] - [방어 ${defRolls.join('+')}=${totalDef}] = ${dmg} 데미지 → ${name(tgt)}`);
                if(hp[tgt]<=0) logs.push(`💀 ${name(tgt)} 전투 불능!`);
            } else {
                motions.push({ side:tgt, anim:'defend', popup:'막음!', popupType:'defend' });
                logs.push(`${icon['방어']} [방어 ${defRolls.join('+')}=${totalDef}] vs [공격 ${totalAtk}] → 완전히 막아냄!`);
            }
        } else {
            // 방어/회피 없음 — 직접 피격
            hp[tgt] = Math.max(0, hp[tgt] - totalAtk);
            motions.push({ side:tgt, anim:'hit', popup:`-${totalAtk}`, popupType:'damage' });
            logs.push(`${icon['공격']} [공격합계 ${totalAtk}] → ${name(tgt)}: -${totalAtk}HP (${atkRolls.join('+')})`);
            if(hp[tgt]<=0) logs.push(`💀 ${name(tgt)} 전투 불능!`);
        }
    }

    // 아무도 공격하지 않은 경우 문구
    if (Object.keys(attacksByTarget).length === 0) {
        const hasAction = ordered.some(s => data[`action_${s}`] && data[`action_${s}`] !== '');
        if (hasAction) logs.push(`🛡️ 이번 턴은 공격이 없었습니다. 모두 무사합니다.`);
        else logs.push(`⏱️ 행동을 선택하지 않아 턴이 넘어갑니다.`);
    }

    const lA = hp['left_a'] > 0 || hp['left_b'] > 0;
    const rA = hp['right_a'] > 0 || hp['right_b'] > 0;
    const isGameOver = (!lA || !rA) || (round >= 5);
    const motionId = ts;

    let resultMsg = [];
    logs.forEach((l,i) => resultMsg.push({ sender:"시스템", text:l, timestamp:ts+i }));

    const updBase = {
        hp_left_a:hp['left_a'], hp_left_b:hp['left_b'],
        hp_right_a:hp['right_a'], hp_right_b:hp['right_b'],
        action_left_a:"", action_left_b:"", action_right_a:"", action_right_b:"",
        target_left_a:"", target_left_b:"", target_right_a:"", target_right_b:"",
        left_done:false, right_done:false,
        lastMotions:motions, lastMotionId:motionId
    };

    if (isGameOver) {
        const ls = hp['left_a'] + hp['left_b'], rs = hp['right_a'] + hp['right_b'];
        let endText = "";
        if (!lA && !rA)  endText = "⚡ 양팀 동시 전투 불능! 무승부!";
        else if (!lA)   { endText = "🏆 오른팀 승리!"; motions.push({side:'right_a',popup:'승리!',popupType:'win'},{side:'right_b',popup:'승리!',popupType:'win'}); }
        else if (!rA)   { endText = "🏆 왼팀 승리!";  motions.push({side:'left_a', popup:'승리!',popupType:'win'},{side:'left_b', popup:'승리!',popupType:'win'}); }
        else if (ls > rs){ endText = `🏆 5라운드 — 왼팀 승리! (${ls} vs ${rs})`; motions.push({side:'left_a',popup:'승리!',popupType:'win'}); }
        else if (rs > ls){ endText = `🏆 5라운드 — 오른팀 승리! (${ls} vs ${rs})`; motions.push({side:'right_a',popup:'승리!',popupType:'win'}); }
        else              endText = "⚡ 5라운드 — 무승부!";
        resultMsg.push({ sender:"시스템", text:endText, timestamp:ts+logs.length+1 });
        await window.dbUtils.updateDoc(roomRef, { ...updBase, status:"ended", messages:window.dbUtils.arrayUnion(...resultMsg) });
    } else {
        const subTurn = data.subTurn || 1; // 1 = A선공 미니턴, 2 = B선공 미니턴

        if (subTurn === 1) {
            // 1번째 미니턴 끝 → 2번째 미니턴 (선후공 교체), 같은 라운드
            const newFirst = origFirst === 'left' ? 'right' : 'left';
            resultMsg.push({ sender:"시스템", text:`↩️ 선후공 교체`, timestamp:ts+logs.length+1 });
            const miniDeadline = Date.now() + 300000;
            await window.dbUtils.updateDoc(roomRef, {
                ...updBase, phase:"turn_a", subTurn:2,
                turnFirst:newFirst, firstSide:newFirst, // 2번째 미니턴의 선공
                turnDeadline:miniDeadline,
                messages:window.dbUtils.arrayUnion(...resultMsg)
            });
        } else {
            // 2번째 미니턴 끝 → 라운드 종료, 다음 라운드 대기
            const nextRound = round + 1;
            // 다음 라운드 1번째 미니턴 선공 = 원래 라운드 선공과 반대 (라운드 번호 홀짝)
            const origRoundFirst = data.origRoundFirst || origSecond; // 이 라운드 최초 선공
            const nextRoundFirst = origRoundFirst === 'left' ? 'right' : 'left';
            resultMsg.push({ sender:"시스템", text:`다음 라운드 준비 중...`, timestamp:ts+logs.length+1 });
            const breakDeadline = Date.now() + 60000;
            await window.dbUtils.updateDoc(roomRef, {
                ...updBase, phase:"break", nextRound,
                nextFirst: nextRoundFirst,
                nextOrigRoundFirst: nextRoundFirst,
                turnFirst: nextRoundFirst, breakDeadline,
                messages:window.dbUtils.arrayUnion(...resultMsg)
            });
        }
    }
}

// ═══════════════════════════════════════════
// [7] 실시간 업데이트 — roomType에 따라 분기
// ═══════════════════════════════════════════
function startRealtimeUpdate(roomId) {
    const roomRef = window.dbUtils.doc(window.db, "rooms", roomId);
    window.dbUtils.onSnapshot(roomRef, (docSnap) => {
        const data=docSnap.data(); if(!data) return;
        _currentRoomData = data; // 타겟 버튼 비활성화용 캐시
        const side=myProfile.side, phase=data.phase||"dice", status=data.status||"waiting";

        if (data.roomType==='2vs2') updateUI2v2(data,side,phase,status);
        else                         updateUI1v1(data,side,phase,status);

        // 모션
        if((status==='fighting'||status==='ended')&&data.lastMotionId){
            if(data.lastMotionId!==_lastMotionId){_lastMotionId=data.lastMotionId;playMotions(data.lastMotions||[]);}
        } else if(status==='waiting'){_lastMotionId=null;}

        // 채팅
        if(data.messages) renderChatMessages(data.messages);
        const sub = data.subTurn || 1;
        document.getElementById('round-display').innerText = `ROUND ${data.currentRound||1} / 5`;
        updateResultOverlay(data,side);

        // ── 타이머 처리 ──
        const phaseKey = `${phase}_${data.turnDeadline||0}_${data.breakDeadline||0}`;
        if (phaseKey !== _lastPhase) {
            _lastPhase = phaseKey;
            clearInterval(_timerInterval);

            if (status === 'fighting' && (phase === 'turn_a' || phase === 'turn_b') && data.turnDeadline) {
                const capturedRoomRef = roomRef;
                const capturedRoomType = data.roomType;
                startCountdown(data.turnDeadline, capturedRoomType, () => {
                    if (side === 'left_a' || (data.roomType!=='2vs2' && side === 'left')) {
                        forceResolve(capturedRoomRef, capturedRoomType);
                    }
                });
            } else if (status === 'fighting' && phase === 'break' && data.breakDeadline) {
                const capturedRoomRef2 = roomRef;
                const capturedRoomType2 = data.roomType;
                startCountdown(data.breakDeadline, capturedRoomType2, async () => {
                    if (side === 'left_a' || (data.roomType!=='2vs2' && side === 'left')) {
                        const snap = await window.dbUtils.getDoc(capturedRoomRef2);
                        if (snap.exists() && snap.data().phase === 'break') {
                            startNextRound(snap.data(), capturedRoomRef2);
                        }
                    }
                });
            } else {
                hideTimer(data.roomType);
            }
        }
    });
}

// ─── 타이머 함수 ───
function startCountdown(deadline, roomType, onExpire) {
    const timerId = roomType === '2vs2' ? 'timer-2v2' : 'timer-1v1';
    const numId   = roomType === '2vs2' ? 'timer-num-2v2' : 'timer-1v1';
    const timerEl = document.getElementById(timerId);
    const numEl   = document.getElementById(numId);
    if (!timerEl) return;
    timerEl.classList.remove('hidden');

    clearInterval(_timerInterval);
    _timerInterval = setInterval(() => {
        const remaining = Math.max(0, Math.ceil((deadline - Date.now()) / 1000));
        if (numEl) {
            const m = Math.floor(remaining / 60);
            const s = remaining % 60;
            numEl.innerText = `${m}:${String(s).padStart(2,'0')}`;
            numEl.style.color = remaining <= 30 ? '#dc2626' : '#3d5c3f';
        }
        if (remaining <= 0) {
            clearInterval(_timerInterval);
            timerEl.classList.add('hidden');
            onExpire();
        }
    }, 500);
}
function hideTimer(roomType) {
    clearInterval(_timerInterval);
    const timerId = roomType === '2vs2' ? 'timer-2v2' : 'timer-1v1';
    const timerEl = document.getElementById(timerId);
    if (timerEl) timerEl.classList.add('hidden');
    // 둘 다 숨기기 (roomType 없을 때 대비)
    document.getElementById('timer-2v2')?.classList.add('hidden');
    document.getElementById('timer-1v1')?.classList.add('hidden');
}

// 강제 결산 (타임아웃) — 최신 데이터 읽고 결산
async function forceResolve(roomRef, roomType) {
    try {
        const snap = await window.dbUtils.getDoc(roomRef);
        if (!snap.exists()) return;
        const d = snap.data();
        if (!['turn_a','turn_b'].includes(d.phase)) return;
        if (d.status !== 'fighting') return;

        if (roomType === '2vs2') {
            await forceResolve2v2(d, roomRef);
        } else {
            await forceResolve1v1(d, roomRef);
        }
    } catch(e) {
        console.error("forceResolve 오류:", e);
    }
}

// 1vs1 강제 결산
async function forceResolve1v1(d, roomRef) {
    const ts = Date.now();
    if (d.phase === 'turn_a') {
        // 선공이 행동 안 함 → turn_b로 강제 전환
        const firstSide  = d.firstSide || d.turnFirst;
        const secondSide = firstSide === 'left' ? 'right' : 'left';
        await window.dbUtils.updateDoc(roomRef, {
            phase:'turn_b', turnFirst:secondSide,
            turnDeadline: ts + 300000,
            messages: window.dbUtils.arrayUnion({ sender:"시스템", text:`⏱️ 시간 초과 — 선공 행동 종료, 후공 차례`, timestamp:ts })
        });
    } else {
        // turn_b 타임아웃 → 즉시 결산
        await window.dbUtils.updateDoc(roomRef, {
            messages: window.dbUtils.arrayUnion({ sender:"시스템", text:`⏱️ 시간 초과 — 후공 행동 종료, 결산합니다`, timestamp:ts })
        });
        const freshSnap = await window.dbUtils.getDoc(roomRef);
        if (freshSnap.exists()) await resolveTurn(freshSnap.data(), roomRef);
    }
}

// 2v2 강제 결산 — turn_a에서 타임아웃 시 turn_b로 즉시 넘기고, turn_b에서 타임아웃 시 바로 결산
async function forceResolve2v2(d, roomRef) {
    const ts = Date.now();
    if (d.phase === 'turn_a') {
        // 선공팀이 아무도 안 골랐거나 일부만 골랐어도 turn_b로 강제 전환
        const firstTeam  = d.turnFirst;
        const secondTeam = firstTeam === 'left' ? 'right' : 'left';
        const update = {
            phase: 'turn_b',
            turnFirst: secondTeam,
            turnDeadline: ts + 300000,
            [`${firstTeam}_done`]: true,
            messages: window.dbUtils.arrayUnion({
                sender: "시스템",
                text: `⏱️ 시간 초과 — 선공팀 행동 종료, ${secondTeam==='left'?'왼팀':'오른팀'} 차례`,
                timestamp: ts
            })
        };
        await window.dbUtils.updateDoc(roomRef, update);
    } else {
        // turn_b 타임아웃 → 바로 결산 (후공팀 행동 종료)
        const secondTeam = d.turnFirst;
        const update = {
            [`${secondTeam}_done`]: true,
            messages: window.dbUtils.arrayUnion({
                sender: "시스템",
                text: `⏱️ 시간 초과 — 후공팀 행동 종료, 결산합니다`,
                timestamp: ts
            })
        };
        // 최신 데이터에 update 머지해서 결산
        await window.dbUtils.updateDoc(roomRef, update);
        const freshSnap = await window.dbUtils.getDoc(roomRef);
        if (freshSnap.exists()) {
            await resolveTurn2v2(freshSnap.data(), roomRef);
        }
    }
}

// 1분 대기 후 다음 라운드 시작
async function startNextRound(data, roomRef) {
    const nextRound = data.nextRound;
    const nextFirst = data.nextFirst;
    const origRoundFirst = data.nextOrigRoundFirst || nextFirst;
    const deadline  = Date.now() + 300000;
    const upd = {
        phase:"turn_a", currentRound:nextRound, turnFirst:nextFirst,
        firstSide: nextFirst, origRoundFirst: origRoundFirst,
        subTurn: 1,
        turnDeadline: deadline, breakDeadline: null,
        action_first:"", action_second:"",
        messages: window.dbUtils.arrayUnion({ sender:"시스템", text:`— ROUND ${nextRound} 시작 — ${nextFirst==='left'?'왼팀':'오른팀'} 선공`, timestamp:Date.now() })
    };
    if (data.roomType === '2vs2') {
        Object.assign(upd, { action_left_a:"",action_left_b:"",action_right_a:"",action_right_b:"", target_left_a:"",target_left_b:"",target_right_a:"",target_right_b:"", left_done:false, right_done:false });
    }
    await window.dbUtils.updateDoc(roomRef, upd);
}

// ─── 1vs1 UI ───
function updateUI1v1(data,side,phase,status){
    document.getElementById('arena-1v1').classList.remove('hidden');
    document.getElementById('arena-2v2').classList.add('hidden');
    // 이름·이미지
    ['left','right'].forEach(s=>{
        const nEl=document.getElementById(`name-${s}`), iEl=document.getElementById(`img-${s}`), raw=data[`name_${s}`];
        if(raw&&raw.includes('|')){const[fn,num]=raw.split('|');nEl.innerText=fn;iEl.innerHTML=`<img src="image/${fn.split(' ')[0]}${num}.png" class="w-full h-full object-cover">`;}
        else{nEl.innerText=raw||"대기 중...";if(!raw)iEl.innerHTML='<span class="text-gray-500 italic">No Image</span>';}
    });
    // 다이스·배지
    ['left','right'].forEach(s=>{
        const dBox=document.getElementById(`dice-${s}`),badge=document.getElementById(`first-badge-${s}`);
        if(!dBox||!badge) return;
        if(data.isDetermined){
            dBox.style.display='none';
            // 배지: firstSide 기준 (라운드 내내 고정)
            const firstSide = data.firstSide || data.turnFirst;
            badge.classList.toggle('hidden', firstSide !== s);
        }
        else{dBox.style.display='';dBox.style.opacity=status==='fighting'?'1':'0.35';dBox.style.cursor=status==='fighting'?'pointer':'not-allowed';dBox.innerText=data[`dice_${s}`]>0?data[`dice_${s}`]:'?';if(data[`dice_${s}`]>0)dBox.classList.remove('dice-rolling');badge.classList.add('hidden');}
    });
    // 레디
    const both=data.name_left&&data.name_right;
    ['left','right'].forEach(s=>{
        const btn=document.getElementById(`ready-btn-${s}`); if(!btn) return;
        if(both&&status==="waiting"&&side===s){btn.classList.remove('hidden');const r=data[`ready_${s}`];btn.textContent=r?'준비 완료':'준비';btn.style.borderColor=r?'#57825a':'';btn.style.color=r?'#89b38c':'';}
        else btn.classList.add('hidden');
    });
    // 레디 오버레이
    const bothReady=both&&data.ready_left&&data.ready_right;
    const ro=document.getElementById('ready-overlay');
    if(bothReady&&status==="waiting"){ro?.classList.remove('hidden');document.getElementById('start-game-btn')?.classList.toggle('hidden',myProfile.type!=="ADMIN");const wm=document.getElementById('waiting-msg');if(wm)wm.style.display=myProfile.type==="ADMIN"?'none':'';}
    else ro?.classList.add('hidden');
    // 선공 트리거
    if(status==='fighting'&&phase==='dice'&&data.dice_left>0&&data.dice_right>0&&!data.isDetermined&&side==='left') determineTurnOrder(data);
    // 행동 버튼
    ['left','right'].forEach(s=>{
        const btns=document.getElementById(`btns-${s}`); if(!btns) return;
        const isFighting=status==='fighting'&&(phase==='turn_a'||phase==='turn_b');
        if(isFighting&&side===s){
            // turnFirst = 현재 행동해야 하는 쪽
            const isMyTurn = data.turnFirst === s;
            // 내가 이미 행동했는지: turn_a에서 action_first, turn_b에서 action_second
            const myAct = (phase==='turn_a') ? (data.turnFirst===s ? data.action_first : null) : (data.turnFirst===s ? data.action_second : data.action_first);
            // 실제로 내가 선택한 행동값 (표시용)
            const myActual = phase==='turn_a' ? (s===data.firstSide ? data.action_first : null) : (s===data.firstSide ? data.action_first : data.action_second);
            const canAct = isMyTurn && !myActual;
            btns.classList.remove('hidden');
            btns.querySelectorAll('button').forEach((b,idx)=>{
                if(canAct){
                    b.disabled=idx===3&&(data.currentRound||1)<3;
                    b.style.opacity=b.disabled?'0.4':'1';
                    b.style.outline='';
                } else {
                    b.disabled=true;
                    if(myActual){
                        b.style.opacity=b.textContent.trim()===myActual?'1':'0.3';
                        b.style.outline=b.textContent.trim()===myActual?'3px solid white':'';
                    } else {
                        b.style.opacity='0.4'; b.style.outline='';
                    }
                }
            });
        } else {
            btns.classList.add('hidden');
            btns.querySelectorAll('button').forEach(b=>{b.disabled=false;b.style.opacity='1';b.style.outline='';});
        }
    });
    // HP
    const hpL=data.hp_left??100, hpR=data.hp_right??100;
    document.getElementById('hp-left').style.width  = Math.max(0,Math.min(100,(hpL/100)*100))+"%";
    document.getElementById('hp-right').style.width = Math.max(0,Math.min(100,(hpR/100)*100))+"%";
    const hlt=document.getElementById('hp-left-text'),hrt=document.getElementById('hp-right-text');
    if(hlt)hlt.innerText=`${Math.max(0,hpL)} / 100`;
    if(hrt)hrt.innerText=`${Math.max(0,hpR)} / 100`;
    // 사망/도주 시 이미지 회색 처리
    const imgL = document.getElementById('img-left'), imgR = document.getElementById('img-right');
    if(imgL) imgL.style.filter = hpL<=0 ? 'grayscale(100%) brightness(0.5)' : '';
    if(imgR) imgR.style.filter = hpR<=0 ? 'grayscale(100%) brightness(0.5)' : '';
}

// ─── 2vs2 UI ───
function updateUI2v2(data,side,phase,status){
    document.getElementById('arena-1v1').classList.add('hidden');
    document.getElementById('arena-2v2').classList.remove('hidden');
    const slots=['left_a','left_b','right_a','right_b'];
    // 이름·이미지·HP
    slots.forEach(s=>{
        const nEl=document.getElementById(`name-${s}`),iEl=document.getElementById(`img-${s}`),hpBar=document.getElementById(`hp-${s}`),hpTxt=document.getElementById(`hp-${s}-text`);
        const raw=data[`name_${s}`];
        if(raw&&raw.includes('|')){const[fn,num]=raw.split('|');if(nEl)nEl.innerText=fn;if(iEl)iEl.innerHTML=`<img src="image/${fn.split(' ')[0]}${num}.png" class="w-full h-full object-cover">`;}
        else{if(nEl)nEl.innerText=raw||"대기 중...";if(!raw&&iEl)iEl.innerHTML='<span class="text-gray-500 text-xs">No Image</span>';}
        const hp    = Math.max(0, data[`hp_${s}`]??100);
        const maxHp = 100;
        const pct   = Math.max(0, Math.min(100, (hp / maxHp) * 100));
        if(hpBar) hpBar.style.width = pct + "%";
        if(hpTxt) hpTxt.innerText  = `${hp} / 100`;
        const wrapper=iEl?.parentElement?.parentElement;
        if(wrapper) wrapper.style.opacity = hp<=0 ? '0.5' : '1';
        // 사망/도주 시 이미지 회색 처리
        if(iEl) iEl.style.filter = hp<=0 ? 'grayscale(100%) brightness(0.5)' : '';
    });
    // 개인 주사위 표시 (2v2)
    ['left_a','left_b','right_a','right_b'].forEach(s=>{
        const dBox=document.getElementById(`dice-${s}`);
        const badge=document.getElementById(`first-badge-${s}`);
        if(!dBox) return;
        if(data.isDetermined){
            dBox.style.display='none';
            // 배지: firstSide 팀 소속이면 표시
            if(badge) badge.classList.toggle('hidden', teamOf(s) !== (data.firstSide||data.turnFirst));
        } else {
            dBox.style.display='';
            const rolled = data[`dice_${s}`]||0;
            dBox.innerText = rolled>0 ? rolled : '?';
            dBox.style.opacity = status==='fighting'?'1':'0.35';
            dBox.style.cursor  = status==='fighting'&&rolled===0?'pointer':'not-allowed';
            if(rolled>0) dBox.classList.remove('dice-rolling');
            if(badge) badge.classList.add('hidden');
        }
    });
    // 레디 — 개인별
    const allJoined=data.name_left_a&&data.name_left_b&&data.name_right_a&&data.name_right_b;
    const slots2v2Ready=['left_a','left_b','right_a','right_b'];
    slots2v2Ready.forEach(s=>{
        const btn=document.getElementById(`ready-btn-${s}`); if(!btn) return;
        if(allJoined&&status==="waiting"&&side===s){
            btn.classList.remove('hidden');
            const r=data[`ready_${s}`]||false;
            btn.textContent=r?'준비완료':'준비';
            btn.style.borderColor=r?'#57825a':'';
            btn.style.color=r?'#89b38c':'';
            btn.disabled=false; btn.style.opacity='1';
        } else {
            btn.classList.add('hidden');
        }
    });
    // 레디 오버레이
    const bothReady=allJoined&&data.ready_left&&data.ready_right;
    const ro=document.getElementById('ready-overlay');
    if(bothReady&&status==="waiting"){ro?.classList.remove('hidden');document.getElementById('start-game-btn')?.classList.toggle('hidden',myProfile.type!=="ADMIN");const wm=document.getElementById('waiting-msg');if(wm)wm.style.display=myProfile.type==="ADMIN"?'none':'';}
    else ro?.classList.add('hidden');
    // 선공 트리거 — 4명 모두 굴렸을 때
    const allRolled = data.dice_left_a>0 && data.dice_left_b>0 && data.dice_right_a>0 && data.dice_right_b>0;
    if(status==='fighting'&&phase==='dice'&&allRolled&&!data.isDetermined&&side==='left_a') determineTurnOrder(data);
    // 행동 버튼
    const isFighting=status==='fighting'&&(phase==='turn_a'||phase==='turn_b');
    slots.forEach(s=>{
        const btns=document.getElementById(`btns-${s}`); if(!btns) return;
        const isMySlot=side===s, isMyTeamTurn=data.turnFirst===teamOf(s), myHp=data[`hp_${s}`]??100, acted=!!data[`action_${s}`];
        const canAct=isFighting&&isMySlot&&isMyTeamTurn&&myHp>0&&!acted;
        if(canAct){
            btns.classList.remove('hidden');
            btns.querySelectorAll('button').forEach(b=>{const isEsc=b.textContent.trim()==='도주';b.disabled=isEsc&&(data.currentRound||1)<3;b.style.opacity=b.disabled?'0.4':'1';b.style.outline='';});
        } else if(isFighting&&isMySlot&&acted){
            btns.classList.remove('hidden');const myAct=data[`action_${s}`];
            btns.querySelectorAll('button').forEach(b=>{b.disabled=true;b.style.opacity=b.textContent.trim()===myAct?'1':'0.3';b.style.outline=b.textContent.trim()===myAct?'3px solid white':'';});
        } else {btns.classList.add('hidden');btns.querySelectorAll('button').forEach(b=>{b.disabled=false;b.style.opacity='1';b.style.outline='';});}
        // 타겟 패널 — 내 슬롯이 아니거나 pending 아닐 때 숨김
        ['atk-targets','def-targets'].forEach(prefix => {
            const tp = document.getElementById(`${prefix}-${s}`);
            if (tp && (side !== s || !_pendingAction2v2)) tp.classList.add('hidden');
        });
    });
}

// ─── 결과창 ───
function updateResultOverlay(data,side){
    const ro=document.getElementById('result-overlay'); if(!ro) return;
    if(data.status!=="ended"){ro.classList.add('hidden');return;}
    ro.classList.remove('hidden');
    const resTitle=document.getElementById('result-title');
    if(data.roomType==='2vs2'){
        const ls=Math.max(0,data.hp_left_a??0)+Math.max(0,data.hp_left_b??0);
        const rs=Math.max(0,data.hp_right_a??0)+Math.max(0,data.hp_right_b??0);
        const lA=ls>0,rA=rs>0; const myTeam=is2v2Side(side)?teamOf(side):side;
        if(!lA&&!rA){resTitle.innerText="무승부!";resTitle.className="text-4xl font-black mb-6 italic tracking-widest text-gray-400";}
        else if(side==='admin'){resTitle.innerText=!lA?"오른팀 승리!":"왼팀 승리!";resTitle.className="text-3xl font-black mb-6 italic text-yellow-400";}
        else{const won=(myTeam==='left'&&(!rA||ls>rs))||(myTeam==='right'&&(!lA||rs>ls));resTitle.innerText=won?"승리!":"패배!";resTitle.className=won?"text-5xl font-black mb-6 italic tracking-widest text-yellow-400":"text-5xl font-black mb-6 italic tracking-widest text-red-500";}
        const rNL=document.getElementById('res-name-left'),rHL=document.getElementById('res-hp-left');
        const rNR=document.getElementById('res-name-right'),rHR=document.getElementById('res-hp-right');
        if(rNL)rNL.innerText=`왼팀: ${(data.name_left_a||'').split('|')[0]} / ${(data.name_left_b||'').split('|')[0]}`;
        if(rHL)rHL.innerText=`HP ${ls}`;
        if(rNR)rNR.innerText=`오른팀: ${(data.name_right_a||'').split('|')[0]} / ${(data.name_right_b||'').split('|')[0]}`;
        if(rHR)rHR.innerText=`HP ${rs}`;
    } else {
        const nL=(data.name_left||'').split('|')[0],nR=(data.name_right||'').split('|')[0];
        const hpL=Math.max(0,data.hp_left??0),hpR=Math.max(0,data.hp_right??0);
        document.getElementById('res-name-left').innerText=nL; document.getElementById('res-hp-left').innerText=`HP ${hpL}`;
        document.getElementById('res-name-right').innerText=nR; document.getElementById('res-hp-right').innerText=`HP ${hpR}`;
        const iLW=hpR<=0||hpL>hpR,iRW=hpL<=0||hpR>hpL;
        if(hpL===hpR){resTitle.innerText="무승부!";resTitle.className="text-4xl font-black mb-6 italic tracking-widest text-gray-400";}
        else if(side==='admin'){resTitle.innerText=iLW?`${nL} 승리!`:`${nR} 승리!`;resTitle.className="text-3xl font-black mb-6 italic text-yellow-400";}
        else{const won=(iLW&&side==='left')||(iRW&&side==='right');resTitle.innerText=won?"승리!":"패배!";resTitle.className=won?"text-5xl font-black mb-6 italic tracking-widest text-yellow-400":"text-5xl font-black mb-6 italic tracking-widest text-red-500";}
    }
}

// ═══════════════════════════════════════════
// 모션
// ═══════════════════════════════════════════
function showPopup(side,text,type){
    const c=document.getElementById(`popup-${side}`); if(!c) return;
    const el=document.createElement('div'); el.className=`combat-popup ${type}`; el.innerText=text;
    el.style.left='50%';el.style.top='40%';el.style.transform='translateX(-50%)';
    c.appendChild(el); setTimeout(()=>el.remove(),1200);
}
function playMotions(motions){
    motions.filter(m=>m.side).forEach((m,i)=>{
        setTimeout(()=>{
            const img=document.getElementById(`img-${m.side}`);
            if(img&&m.anim){img.classList.remove('anim-attack','anim-hit','anim-dodge','anim-defend','anim-flee');void img.offsetWidth;img.classList.add(`anim-${m.anim}`);img.addEventListener('animationend',()=>img.classList.remove(`anim-${m.anim}`),{once:true});}
            if(m.popup) showPopup(m.side,m.popup,m.popupType||'damage');
        },i*220);
    });
}

// ═══════════════════════════════════════════
// 방 목록 / 초기화
// ═══════════════════════════════════════════
// ═══════════════════════════════════════════
// 채팅 탭
// ═══════════════════════════════════════════
let _currentChatTab = 'notice'; // 현재 탭
let _lastNoticeCount = 0;
let _lastChatCount = 0;

function switchChatTab(tab) {
    _currentChatTab = tab;
    const noticeEl = document.getElementById('tab-notice');
    const chatEl   = document.getElementById('tab-chat');
    const btnN     = document.getElementById('tab-btn-notice');
    const btnC     = document.getElementById('tab-btn-chat');
    if (!noticeEl || !chatEl) return;

    if (tab === 'notice') {
        noticeEl.style.display = '';
        chatEl.style.display   = 'none';
        btnN.style.background = '#57825a'; btnN.style.color = 'white'; btnN.style.outline = '';
        btnC.style.background = 'rgba(0,0,0,0.3)'; btnC.style.color = '#aaa';
        noticeEl.scrollTop = noticeEl.scrollHeight;
    } else {
        chatEl.style.display   = '';
        noticeEl.style.display = 'none';
        btnC.style.background = '#57825a'; btnC.style.color = 'white'; btnC.style.outline = '';
        btnN.style.background = 'rgba(0,0,0,0.3)'; btnN.style.color = '#aaa';
        chatEl.scrollTop = chatEl.scrollHeight;
    }
}

function renderChatMessages(messages) {
    const noticeEl = document.getElementById('tab-notice');
    const chatEl   = document.getElementById('tab-chat');
    if (!noticeEl || !chatEl || !messages) return;

    // 메시지를 안내/채팅으로 분리
    const noticeMs = messages.filter(m => m.sender === '시스템');
    const chatMs   = messages.filter(m => m.sender !== '시스템');

    // 안내 탭 업데이트
    if (noticeMs.length !== _lastNoticeCount) {
        _lastNoticeCount = noticeMs.length;
        noticeEl.innerHTML = '';
        noticeMs.forEach(msg => {
            const el = document.createElement('div');
            el.className = 'py-1 border-b border-white/10';
            el.innerHTML = `<span class="text-yellow-400 font-bold">[안내] ${msg.text}</span>`;
            noticeEl.appendChild(el);
        });
        if (_currentChatTab === 'notice') noticeEl.scrollTop = noticeEl.scrollHeight;
        // 새 안내 있으면 탭 버튼 강조
        const btnN = document.getElementById('tab-btn-notice');
        if (btnN && _currentChatTab !== 'notice') btnN.style.outline = '2px solid #facc15';
    }

    // 채팅 탭 업데이트
    if (chatMs.length !== _lastChatCount) {
        _lastChatCount = chatMs.length;
        chatEl.innerHTML = '';
        chatMs.forEach(msg => {
            const el = document.createElement('div');
            el.className = 'py-1 border-b border-white/10 text-white';
            if (msg.sender === '관리자') {
                el.innerHTML = `<span class="text-red-500 font-bold">${msg.sender}:</span> <span class="text-red-200">${msg.text}</span>`;
            } else {
                el.innerHTML = `<span class="text-green-400 font-bold">${msg.sender}:</span> ${msg.text}`;
            }
            chatEl.appendChild(el);
        });
        if (_currentChatTab === 'chat') chatEl.scrollTop = chatEl.scrollHeight;
        // 새 채팅 있으면 탭 버튼 강조
        const btnC = document.getElementById('tab-btn-chat');
        if (btnC && _currentChatTab !== 'chat') btnC.style.outline = '2px solid #4ade80';
    }

    // 현재 탭 버튼 강조 해제
    const activeBtn = document.getElementById(`tab-btn-${_currentChatTab}`);
    if (activeBtn) activeBtn.style.outline = '';
}
function setupChatEventListeners(){
    document.getElementById('chat-input')?.addEventListener('keypress',e=>{if(e.key==='Enter')sendChat();});
}
function listenToRoomList(){
    const roomsCol=window.dbUtils.collection(window.db,"rooms");
    window.dbUtils.onSnapshot(roomsCol,snapshot=>{
        const div=document.getElementById('room-list'); if(!div) return;
        div.innerHTML=snapshot.empty?'<p class="text-center text-gray-400">생성된 방이 없습니다.</p>':"";
        snapshot.forEach(d=>{
            const rd=d.data();
            const item=document.createElement('div');
            item.className="flex justify-between items-center bg-gray-700 p-3 mb-2 rounded hover:bg-gray-600 transition";
            item.innerHTML=`<div><span class="text-yellow-400 font-bold">[${rd.roomType}]</span> ${rd.roomName||d.id}</div><button class="join-btn bg-green-600 px-3 py-1 rounded text-sm hover:bg-green-500">입장</button>`;
            item.querySelector('.join-btn').addEventListener('click',async()=>{
                if(myProfile.type==="ADMIN"){joinRoom(d.id,"admin");return;}
                const snap=await window.dbUtils.getDoc(window.dbUtils.doc(window.db,"rooms",d.id));
                if(!snap.exists()) return;
                const sd=snap.data();
                if(sd.roomType==='1vs1'){
                    if(sd.playersCount>=2||(sd.name_left&&sd.name_right)){alert("인원이 모두 찼습니다.");return;}
                    joinRoom(d.id,sd.name_left?.trim()?"right":"left");
                } else {
                    const allFull=['left_a','left_b','right_a','right_b'].every(s=>sd[`name_${s}`]?.trim());
                    if(allFull){alert("인원이 모두 찼습니다.");return;}
                    openTeamSelectModal(d.id,rd.roomName||d.id);
                }
            });
            div.appendChild(item);
        });
    });
}
function init(){listenToRoomList();setupChatEventListeners();}
window.onload=init;

// 전역 바인딩
window.rollDice=rollDice; window.rollDice2v2=rollDice2v2; window.switchChatTab=switchChatTab; window.createRoom=createRoom; window.joinRoom=joinRoom;
window.sendChat=sendChat; window.selectCharacter=selectCharacter;
window.backToLobby=backToLobby; window.backToCharacterSelection=backToCharacterSelection;
window.openCreateModal=openCreateModal; window.closeCreateModal=closeCreateModal;
window.confirmCreateRoom=confirmCreateRoom; window.startGame=startGame;
window.toggleReady=toggleReady; window.toggleReady2v2=toggleReady2v2;
window.selectAction=selectAction; window.selectAction2v2=selectAction2v2; window.selectTarget2v2=selectTarget2v2; window.selectDefendTarget2v2=selectDefendTarget2v2;
window.confirmTeamSelect=confirmTeamSelect; window.closeTeamSelectModal=closeTeamSelectModal;

function openCreateModal(){document.getElementById('create-room-modal').classList.remove('hidden');}
function closeCreateModal(){document.getElementById('create-room-modal').classList.add('hidden');}
async function confirmCreateRoom(){
    const ti=document.getElementById('room-title-input'),ts=document.getElementById('room-type-select');
    const title=ti.value.trim()||"즐거운 전투"; closeCreateModal();
    await createRoom(ts.value,title); ti.value="";
}
async function backToLobby(){
    if(!confirm("정말 전투를 포기하고 로비로 나가시겠습니까?")) return;
    if(currentRoomId){
        const roomRef=window.dbUtils.doc(window.db,"rooms",currentRoomId);
        const roomSnap=await window.dbUtils.getDoc(roomRef);
        if(roomSnap.exists()){
            const d=roomSnap.data(); const newCount=(d.playersCount||1)-1;
            if(newCount<=0){await window.dbUtils.deleteDoc(roomRef);}
            else{
                const upd={playersCount:newCount,messages:window.dbUtils.arrayUnion({sender:"시스템",text:`${myProfile.name} 님이 퇴장했습니다.`,timestamp:Date.now()})};
                if(myProfile.side!=='admin') upd[`name_${myProfile.side}`]="";
                await window.dbUtils.updateDoc(roomRef,upd);
            }
        }
    }
    currentRoomId="";myProfile.side="";_lastMotionId=null;_pendingAction2v2=null;
    document.getElementById('user-profile-display').classList.remove('hidden');
    document.getElementById('battle-screen').classList.add('hidden');
    document.getElementById('game-lobby').classList.remove('hidden');
    document.getElementById('result-overlay')?.classList.add('hidden');
}
function backToCharacterSelection(){
    if(!confirm("캐릭터 선택창으로 돌아가시겠습니까?")) return;
    document.getElementById('user-profile-display')?.classList.add('hidden');
    document.getElementById('game-lobby').classList.add('hidden');
    document.getElementById('character-selection').classList.remove('hidden');
    myProfile={name:"",type:"",side:""};
}
async function sendChat(){
    const input=document.getElementById('chat-input');
    if(!input.value||!currentRoomId) return;
    await window.dbUtils.updateDoc(window.dbUtils.doc(window.db,"rooms",currentRoomId),{messages:window.dbUtils.arrayUnion({sender:myProfile.name,text:input.value,timestamp:Date.now()})});
    input.value="";
}
async function startGame(){
    if(!currentRoomId) return;
    _lastMotionId=null;_pendingAction2v2=null;
    const roomRef=window.dbUtils.doc(window.db,"rooms",currentRoomId);
    const snap=await window.dbUtils.getDoc(roomRef); if(!snap.exists()) return;
    const d=snap.data();
    ['left','right'].forEach(s=>{
        const dBox=document.getElementById(`dice-${s}`);
        if(dBox){dBox.style.display='';dBox.innerText='?';dBox.classList.remove('dice-rolling');}
        document.getElementById(`first-badge-${s}`)?.classList.add('hidden');
    });

    // 최신 maxHp를 characters 컬렉션에서 재조회
    async function getFreshHp(nameField) {
        const raw = d[nameField];
        if (!raw) return 100;
        const charName = raw.split('|')[0];
        try {
            const cs = await window.dbUtils.getDoc(window.dbUtils.doc(window.db, "characters", charName));
            return (cs.exists() && cs.data().maxHp !== undefined) ? cs.data().maxHp : 100;
        } catch { return 100; }
    }

    const upd={status:"fighting",ready_left:false,ready_right:false,dice_left:0,dice_right:0,isDetermined:false,firstSide:"",turnFirst:"",phase:"dice",currentRound:1,subTurn:1,origRoundFirst:"",lastMotions:[],lastMotionId:0,messages:window.dbUtils.arrayUnion({sender:"시스템",text:"⚔️ 전투 시작! 다이스를 굴려 선공을 결정하세요.",timestamp:Date.now()})};

    if(d.roomType==='1vs1'){
        const hL = await getFreshHp('name_left');
        const hR = await getFreshHp('name_right');
        upd.hp_left=hL; upd.hp_right=hR;
        upd.start_hp_left=hL; upd.start_hp_right=hR;
        upd.action_first=""; upd.action_second="";
    } else {
        const hLA = await getFreshHp('name_left_a');
        const hLB = await getFreshHp('name_left_b');
        const hRA = await getFreshHp('name_right_a');
        const hRB = await getFreshHp('name_right_b');
        upd.hp_left_a=hLA; upd.hp_left_b=hLB; upd.hp_right_a=hRA; upd.hp_right_b=hRB;
        upd.start_hp_left_a=hLA; upd.start_hp_left_b=hLB; upd.start_hp_right_a=hRA; upd.start_hp_right_b=hRB;
        upd.action_left_a="";upd.action_left_b="";upd.action_right_a="";upd.action_right_b="";
        upd.target_left_a="";upd.target_left_b="";upd.target_right_a="";upd.target_right_b="";
        upd.left_done=false;upd.right_done=false;
        upd.dice_left_a=0;upd.dice_left_b=0;upd.dice_right_a=0;upd.dice_right_b=0;
    }
    await window.dbUtils.updateDoc(roomRef,upd);
}
