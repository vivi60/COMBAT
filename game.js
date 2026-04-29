// ═══════════════════════════════════════════
// 전역 변수
// ═══════════════════════════════════════════
let myProfile = { name: "", type: "", side: "" };
let currentRoomId = "";
let _lastMotionId = null;
let _pendingAction2v2 = null;
let _pendingRoomId = "";

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
// [5] 다이스 굴리기 (팀 단위)
// ═══════════════════════════════════════════
async function rollDice(side) {
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
    document.getElementById(`dice-${side}`).classList.add('dice-rolling');
    const result = Math.floor(Math.random() * 100) + 1;
    setTimeout(async () => { await window.dbUtils.updateDoc(roomRef, { [`dice_${side}`]: result }); }, 500);
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
    const first = data.dice_left >= data.dice_right ? "left" : "right";
    const roomRef = window.dbUtils.doc(window.db, "rooms", currentRoomId);
    const upd = {
        isDetermined:true, firstSide:first, turnFirst:first, phase:"turn_a",
        messages: window.dbUtils.arrayUnion({ sender:"시스템", text:`🎲 ${data.dice_left} vs ${data.dice_right} → ${first==='left'?'왼팀':'오른팀'} 선공!`, timestamp:Date.now() })
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
            const iAmFirst = d.turnFirst === side;
            if (iAmFirst) {
                if (d.action_first) throw new Error("이미_선택");
                tx.update(roomRef, { action_first:action, messages:window.dbUtils.arrayUnion({ sender:"시스템", text:`${myProfile.name} 님이 행동을 선택했습니다.`, timestamp:Date.now() }) });
            } else {
                if (!d.action_first) throw new Error("상대_미선택");
                if (d.action_second) throw new Error("이미_선택");
                tx.update(roomRef, { action_second:action });
                shouldResolve = true; resolveData = { ...d, action_second:action };
            }
        });
    } catch(e) {
        if (e.message==="도주_불가")   { alert("도주는 3라운드부터 가능합니다!"); return; }
        if (e.message==="이미_선택")   { alert("이미 행동을 선택했습니다!"); return; }
        if (e.message==="상대_미선택") { alert("선공이 먼저 행동을 선택해야 합니다!"); return; }
        console.error("selectAction 오류:", e); return;
    }
    const btns = document.getElementById(`btns-${side}`);
    if (btns) btns.querySelectorAll('button').forEach(b => { b.disabled=true; b.style.opacity=b.textContent.trim()===action?'1':'0.3'; b.style.outline=b.textContent.trim()===action?'3px solid white':''; });
    if (shouldResolve && resolveData) await resolveTurn(resolveData, roomRef);
}

// ═══════════════════════════════════════════
// [전투] 2vs2 행동 선택
// ═══════════════════════════════════════════
async function selectAction2v2(slot, action) {
    // slot: 'left_a' 등, action: '공격'|'방어'|'회피'|'도주'
    if (!currentRoomId || myProfile.side !== slot) return;

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
        _pendingAction2v2 = '공격';
        showPanel(`atk-targets-${slot}`, true);
        return;
    }
    if (action === '방어') {
        _pendingAction2v2 = '방어';
        // 방어 대상 버튼 이름 업데이트
        const shortMap = {'left_a':'la','left_b':'lb','right_a':'ra','right_b':'rb'};
        const ms = shortMap[slot];
        const allies = teamOf(slot)==='left'
            ? [['la','left_a'], ['lb','left_b']]
            : [['ra','right_a'], ['rb','right_b']];
        allies.forEach(([ashort, aslot]) => {
            const nameEl = document.getElementById(`name-${aslot}`);
            const tEl = document.getElementById(`dname-${ashort}-${ms}`);
            if (tEl && nameEl) tEl.innerText = aslot === slot ? `${nameEl.innerText}(나)` : nameEl.innerText;
        });
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
            const partnerDone = !!d[`action_${partnerSlot}`];
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
    const tf = data.turnFirst, ts2 = tf==='left'?'right':'left';
    const aF=data.action_first, aS=data.action_second;
    const nF=data[`name_${tf}`].split('|')[0], nS=data[`name_${ts2}`].split('|')[0];
    const round=data.currentRound||1, phase=data.phase, ts=Date.now();
    let hpF=data[`hp_${tf}`], hpS=data[`hp_${ts2}`];
    const logs=[], motions=[], icon={'공격':'⚔️','방어':'🛡️','회피':'💨','도주':'🏃'};
    logs.push(`${icon[aF]||''} ${nF}의 행동: ${aF}`);
    logs.push(`${icon[aS]||''} ${nS}의 행동: ${aS}`);

    if (aF==='공격'&&aS==='공격') {
        const atk=rollAttack(); hpS=Math.max(0,hpS-atk);
        motions.push({side:tf,anim:'attack'},{side:ts2,anim:'hit',popup:`-${atk}`,popupType:'damage'});
        logs.push(`${nF} 공격 ${atk} → ${nS} -${atk}HP`);
        if (hpS>0) { const atk2=rollAttack(); hpF=Math.max(0,hpF-atk2); motions.push({side:ts2,anim:'attack'},{side:tf,anim:'hit',popup:`-${atk2}`,popupType:'damage'}); logs.push(`${nS} 반격 ${atk2} → ${nF} -${atk2}HP`); }
        else logs.push(`${nS} 쓰러져 반격 불가!`);
    } else if (aF==='공격'&&aS==='방어') {
        const atk=rollAttack(),def=rollDefense(),dmg=Math.max(0,atk-def); hpS=Math.max(0,hpS-dmg);
        motions.push({side:tf,anim:'attack'},{side:ts2,anim:'defend',popup:dmg>0?`-${dmg}`:'막음!',popupType:dmg>0?'damage':'defend'});
        logs.push(dmg>0?`공격 ${atk} - 방어 ${def} = ${dmg} 데미지`:`완전히 막아냈습니다!`);
    } else if (aF==='방어'&&aS==='공격') {
        const atk=rollAttack(),def=rollDefense(),dmg=Math.max(0,atk-def); hpF=Math.max(0,hpF-dmg);
        motions.push({side:ts2,anim:'attack'},{side:tf,anim:'defend',popup:dmg>0?`-${dmg}`:'막음!',popupType:dmg>0?'damage':'defend'});
        logs.push(dmg>0?`공격 ${atk} - 방어 ${def} = ${dmg} 데미지`:`완전히 막아냈습니다!`);
    } else if (aF==='공격'&&aS==='회피') {
        const atk=rollAttack(),dodged=Math.random()<0.5;
        motions.push({side:tf,anim:'attack'},{side:ts2,anim:'dodge',popup:dodged?'회피!':'실패!',popupType:dodged?'miss':'damage'});
        if (dodged) logs.push(`${nS} 회피 성공!`); else { hpS=Math.max(0,hpS-atk); logs.push(`회피 실패! -${atk}HP`); }
    } else if (aF==='회피'&&aS==='공격') {
        const atk=rollAttack(),dodged=Math.random()<0.5;
        motions.push({side:ts2,anim:'attack'},{side:tf,anim:'dodge',popup:dodged?'회피!':'실패!',popupType:dodged?'miss':'damage'});
        if (dodged) logs.push(`${nF} 회피 성공!`); else { hpF=Math.max(0,hpF-atk); logs.push(`회피 실패! -${atk}HP`); }
    } else if (aF==='공격'&&aS==='도주') {
        const atk=rollAttack(),esc=Math.random()<0.5;
        motions.push({side:ts2,anim:'flee',popup:esc?'도주!':'실패!',popupType:'flee'});
        if (esc) { hpS=0; logs.push(`${nS} 도주 성공!`); } else { motions.push({side:tf,anim:'attack'},{side:ts2,anim:'hit',popup:`-${atk}`,popupType:'damage'}); hpS=Math.max(0,hpS-atk); logs.push(`도주 실패! -${atk}HP`); }
    } else if (aF==='도주'&&aS==='공격') {
        const atk=rollAttack(),esc=Math.random()<0.5;
        motions.push({side:tf,anim:'flee',popup:esc?'도주!':'실패!',popupType:'flee'});
        if (esc) { hpF=0; logs.push(`${nF} 도주 성공!`); } else { motions.push({side:ts2,anim:'attack'},{side:tf,anim:'hit',popup:`-${atk}`,popupType:'damage'}); hpF=Math.max(0,hpF-atk); logs.push(`도주 실패! -${atk}HP`); }
    } else if (aF==='도주'&&aS==='도주') {
        const eF=Math.random()<0.5,eS=Math.random()<0.5;
        motions.push({side:tf,anim:'flee',popup:eF?'도주!':'실패!',popupType:'flee'},{side:ts2,anim:'flee',popup:eS?'도주!':'실패!',popupType:'flee'});
        if(eF) hpF=0; if(eS) hpS=0; logs.push(`${nF} 도주 ${eF?'성공':'실패'} / ${nS} 도주 ${eS?'성공':'실패'}`);
    } else if (aF==='도주') {
        const esc=Math.random()<0.5; motions.push({side:tf,anim:'flee',popup:esc?'도주!':'실패!',popupType:'flee'});
        if(aS==='회피') motions.push({side:ts2,anim:'dodge'}); else if(aS==='방어') motions.push({side:ts2,anim:'defend'});
        if(esc){hpF=0;logs.push(`${nF} 도주 성공!`);}else logs.push(`${nF} 도주 실패! 피해 없음.`);
    } else if (aS==='도주') {
        const esc=Math.random()<0.5; motions.push({side:ts2,anim:'flee',popup:esc?'도주!':'실패!',popupType:'flee'});
        if(aF==='회피') motions.push({side:tf,anim:'dodge'}); else if(aF==='방어') motions.push({side:tf,anim:'defend'});
        if(esc){hpS=0;logs.push(`${nS} 도주 성공!`);}else logs.push(`${nS} 도주 실패! 피해 없음.`);
    } else { logs.push(`서로 맞붙지 않아 피해가 없습니다.`); }

    const hp_left=tf==='left'?hpF:hpS, hp_right=tf==='left'?hpS:hpF;
    const nL=data.name_left.split('|')[0], nR=data.name_right.split('|')[0];
    const motionId=ts;
    const isGameOver=(hp_left<=0||hp_right<=0)||(phase==='turn_b'&&round>=5);
    let resultMsg=[]; logs.forEach((l,i)=>resultMsg.push({sender:"시스템",text:l,timestamp:ts+i}));

    if (isGameOver) {
        let endText="";
        if(hp_left<=0&&hp_right<=0){endText="⚡ 무승부!";}
        else if(hp_left<=0){endText=`🏆 ${nR} 승리!`;motions.push({side:'right',popup:'승리!',popupType:'win'});}
        else if(hp_right<=0){endText=`🏆 ${nL} 승리!`;motions.push({side:'left',popup:'승리!',popupType:'win'});}
        else if(hp_left>hp_right){endText=`🏆 5라운드 — ${nL} 승리! (${hp_left} vs ${hp_right})`;motions.push({side:'left',popup:'승리!',popupType:'win'});}
        else if(hp_right>hp_left){endText=`🏆 5라운드 — ${nR} 승리! (${hp_left} vs ${hp_right})`;motions.push({side:'right',popup:'승리!',popupType:'win'});}
        else{endText=`⚡ 5라운드 — 무승부!`;}
        resultMsg.push({sender:"시스템",text:endText,timestamp:ts+logs.length+1});
        await window.dbUtils.updateDoc(roomRef,{hp_left,hp_right,action_first:"",action_second:"",status:"ended",lastMotions:motions,lastMotionId:motionId,messages:window.dbUtils.arrayUnion(...resultMsg)});
    } else if (phase==='turn_a') {
        const newF=tf==='left'?'right':'left';
        resultMsg.push({sender:"시스템",text:`↩️ 선후공 교체 — ${data[`name_${newF}`].split('|')[0]} 먼저!`,timestamp:ts+logs.length+1});
        await window.dbUtils.updateDoc(roomRef,{hp_left,hp_right,action_first:"",action_second:"",phase:"turn_b",turnFirst:newF,lastMotions:motions,lastMotionId:motionId,messages:window.dbUtils.arrayUnion(...resultMsg)});
    } else {
        const nextRound=round+1, orig=data.firstSide;
        const nextFirst=(nextRound%2===1)?orig:(orig==='left'?'right':'left');
        resultMsg.push({sender:"시스템",text:`— ROUND ${nextRound} 시작 — ${data[`name_${nextFirst}`].split('|')[0]} 선공`,timestamp:ts+logs.length+1});
        await window.dbUtils.updateDoc(roomRef,{hp_left,hp_right,action_first:"",action_second:"",currentRound:nextRound,phase:"turn_a",turnFirst:nextFirst,lastMotions:motions,lastMotionId:motionId,messages:window.dbUtils.arrayUnion(...resultMsg)});
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
            } else {
                motions.push({ side:tgt, anim:'defend', popup:'막음!', popupType:'defend' });
                logs.push(`${icon['방어']} [방어 ${defRolls.join('+')}=${totalDef}] vs [공격 ${totalAtk}] → 완전히 막아냄!`);
            }
        } else {
            // 방어/회피 없음 — 직접 피격
            hp[tgt] = Math.max(0, hp[tgt] - totalAtk);
            motions.push({ side:tgt, anim:'hit', popup:`-${totalAtk}`, popupType:'damage' });
            logs.push(`${icon['공격']} [공격합계 ${totalAtk}] → ${name(tgt)}: -${totalAtk}HP (${atkRolls.join('+')})`);
        }
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
        const nextRound = round + 1;
        const nextFirst = (nextRound % 2 === 1) ? origFirst : origSecond;
        resultMsg.push({ sender:"시스템", text:`— ROUND ${nextRound} 시작 — ${nextFirst==='left'?'왼팀':'오른팀'} 선공`, timestamp:ts+logs.length+1 });
        await window.dbUtils.updateDoc(roomRef, { ...updBase, currentRound:nextRound, phase:"turn_a", turnFirst:nextFirst, messages:window.dbUtils.arrayUnion(...resultMsg) });
    }
}

// ═══════════════════════════════════════════
// [7] 실시간 업데이트 — roomType에 따라 분기
// ═══════════════════════════════════════════
function startRealtimeUpdate(roomId) {
    const roomRef = window.dbUtils.doc(window.db, "rooms", roomId);
    window.dbUtils.onSnapshot(roomRef, (docSnap) => {
        const data=docSnap.data(); if(!data) return;
        const side=myProfile.side, phase=data.phase||"dice", status=data.status||"waiting";
        if (data.roomType==='2vs2') updateUI2v2(data,side,phase,status);
        else                         updateUI1v1(data,side,phase,status);
        // 모션
        if((status==='fighting'||status==='ended')&&data.lastMotionId){
            if(data.lastMotionId!==_lastMotionId){_lastMotionId=data.lastMotionId;playMotions(data.lastMotions||[]);}
        } else if(status==='waiting'){_lastMotionId=null;}
        // 채팅
        if(data.messages){
            const chatBox=document.getElementById('chat-messages');
            if(chatBox.children.length!==data.messages.length){
                chatBox.innerHTML="";
                data.messages.forEach(msg=>{
                    const log=document.createElement('div'); log.className="text-white py-1 border-b border-white/10";
                    if(msg.sender==="시스템") log.innerHTML=`<span class="text-yellow-400 font-bold">[안내] ${msg.text}</span>`;
                    else if(msg.sender==="관리자") log.innerHTML=`<span class="text-red-500 font-bold">${msg.sender}:</span> <span class="text-red-200">${msg.text}</span>`;
                    else log.innerHTML=`<span class="text-green-400 font-bold">${msg.sender}:</span> ${msg.text}`;
                    chatBox.appendChild(log);
                });
                chatBox.scrollTop=chatBox.scrollHeight;
            }
        }
        document.getElementById('round-display').innerText=`ROUND ${data.currentRound||1} / 5`;
        updateResultOverlay(data,side);
    });
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
        if(data.isDetermined){dBox.style.display='none';badge.classList.toggle('hidden',data.turnFirst!==s);}
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
            const iAmFirst=data.turnFirst===s, myAct=iAmFirst?data.action_first:data.action_second, canAct=iAmFirst?!myAct:(!!data.action_first&&!myAct);
            btns.classList.remove('hidden');
            btns.querySelectorAll('button').forEach((b,idx)=>{
                if(canAct){b.disabled=idx===3&&(data.currentRound||1)<3;b.style.opacity=b.disabled?'0.4':'1';b.style.outline='';}
                else{b.disabled=true;if(myAct){b.style.opacity=b.textContent.trim()===myAct?'1':'0.3';b.style.outline=b.textContent.trim()===myAct?'3px solid white':'';}else{b.style.opacity='0.4';b.style.outline='';}}
            });
        } else {btns.classList.add('hidden');btns.querySelectorAll('button').forEach(b=>{b.disabled=false;b.style.opacity='1';b.style.outline='';});}
    });
    // HP
    const hpL=data.hp_left??100,hpR=data.hp_right??100;
    document.getElementById('hp-left').style.width=Math.max(0,hpL)+"%";
    document.getElementById('hp-right').style.width=Math.max(0,hpR)+"%";
    const hlt=document.getElementById('hp-left-text'),hrt=document.getElementById('hp-right-text');
    if(hlt)hlt.innerText=`${Math.max(0,hpL)} / 100`;
    if(hrt)hrt.innerText=`${Math.max(0,hpR)} / 100`;
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
        const hp=Math.max(0,data[`hp_${s}`]??100);
        if(hpBar)hpBar.style.width=hp+"%";
        if(hpTxt)hpTxt.innerText=`${hp}`;
        const wrapper=iEl?.parentElement?.parentElement;
        if(wrapper)wrapper.style.opacity=hp<=0?'0.4':'1';
    });
    // 다이스·배지
    ['left','right'].forEach(s=>{
        const dBox=document.getElementById(`dice-${s}-2v2`),badge=document.getElementById(`first-badge-${s}-2v2`);
        if(!dBox||!badge) return;
        if(data.isDetermined){dBox.style.display='none';badge.classList.toggle('hidden',data.turnFirst!==s);}
        else{dBox.style.display='';dBox.style.opacity=status==='fighting'?'1':'0.35';dBox.style.cursor=status==='fighting'?'pointer':'not-allowed';dBox.innerText=data[`dice_${s}`]>0?data[`dice_${s}`]:'?';if(data[`dice_${s}`]>0)dBox.classList.remove('dice-rolling');badge.classList.add('hidden');}
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
    // 선공 트리거
    if(status==='fighting'&&phase==='dice'&&data.dice_left>0&&data.dice_right>0&&!data.isDetermined&&side==='left_a') determineTurnOrder(data);
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
window.rollDice=rollDice; window.createRoom=createRoom; window.joinRoom=joinRoom;
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
    const upd={status:"fighting",ready_left:false,ready_right:false,dice_left:0,dice_right:0,isDetermined:false,firstSide:"",turnFirst:"",phase:"dice",currentRound:1,lastMotions:[],lastMotionId:0,messages:window.dbUtils.arrayUnion({sender:"시스템",text:"⚔️ 전투 시작! 다이스를 굴려 선공을 결정하세요.",timestamp:Date.now()})};
    if(d.roomType==='1vs1'){upd.hp_left=d.start_hp_left??100;upd.hp_right=d.start_hp_right??100;upd.action_first="";upd.action_second="";}
    else{upd.hp_left_a=d.start_hp_left_a??100;upd.hp_left_b=d.start_hp_left_b??100;upd.hp_right_a=d.start_hp_right_a??100;upd.hp_right_b=d.start_hp_right_b??100;upd.action_left_a="";upd.action_left_b="";upd.action_right_a="";upd.action_right_b="";upd.target_left_a="";upd.target_left_b="";upd.target_right_a="";upd.target_right_b="";upd.left_done=false;upd.right_done=false;}
    await window.dbUtils.updateDoc(roomRef,upd);
}
