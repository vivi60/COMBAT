// ═══════════════════════════════════════════
// 전역 변수
// ═══════════════════════════════════════════
let myProfile = { name: "", type: "", side: "" };
let currentRoomId = "";
let _lastMotionId = null; // 모션 중복 재생 방지

// ═══════════════════════════════════════════
// 주사위 유틸
// ═══════════════════════════════════════════
function roll(max) { return Math.floor(Math.random() * max) + 1; }
function rollAttack()  { return roll(15) + roll(5); }
function rollDefense() { return roll(15) + roll(5); }

// ═══════════════════════════════════════════
// [2] 캐릭터 선택
// ═══════════════════════════════════════════
function selectCharacter(name, isAdmin, num) {
    myProfile.name   = name;
    myProfile.charId = `${name}|${num || 1}`;
    myProfile.type   = isAdmin ? "ADMIN" : "PLAYER";

    const profileDisplay = document.getElementById('user-profile-display');
    if (profileDisplay) {
        profileDisplay.classList.remove('hidden');
        document.getElementById('my-char-name').innerText = name;
        const imgSrc = isAdmin
            ? "image/관리자.png"
            : `image/${name.split(' ')[0]}${num || 1}.png`;
        document.getElementById('my-char-img').innerHTML =
            `<img src="${imgSrc}" class="w-full h-full object-cover">`;
    }
    document.getElementById('character-selection').classList.add('hidden');
    document.getElementById('game-lobby').classList.remove('hidden');
}

// ═══════════════════════════════════════════
// [3] 방 만들기
// ═══════════════════════════════════════════
async function createRoom(type, title) {
    const newRoomId = title + "_" + Math.floor(Math.random() * 1000);
    const roomRef   = window.dbUtils.doc(window.db, "rooms", newRoomId);

    await window.dbUtils.setDoc(roomRef, {
        roomType: type, roomName: title,
        status: "waiting",
        hp_left: 100, hp_right: 100,
        dice_left: 0, dice_right: 0,
        playersCount: 0,
        currentRound: 1,
        isDetermined: false,
        firstSide: "",
        turnFirst: "",
        phase: "dice",
        ready_left: false, ready_right: false,
        name_left: "", name_right: "",
        action_first: "",
        action_second: "",
        lastMotionId: 0,
        lastMotions: [],
        messages: []
    });

    joinRoom(newRoomId, myProfile.type === "ADMIN" ? "admin" : "left");
}

// ═══════════════════════════════════════════
// [4] 방 입장
// ═══════════════════════════════════════════
async function joinRoom(roomId, side) {
    currentRoomId = roomId;
    _lastMotionId = null;
    const roomRef = window.dbUtils.doc(window.db, "rooms", roomId);
    let updateData = {};

    try {
        if (myProfile.type === "ADMIN" || side === "admin") {
            myProfile.side = "admin";
            updateData = { messages: window.dbUtils.arrayUnion({
                sender: "시스템", text: "관리자 님이 입장했습니다.", timestamp: Date.now()
            })};
        } else {
            myProfile.side = side;
            updateData = {
                playersCount: window.dbUtils.increment(1),
                messages: window.dbUtils.arrayUnion({
                    sender: "시스템",
                    text: `${myProfile.name} 님이 ${side === 'left' ? '왼쪽' : '오른쪽'} 팀으로 입장했습니다.`,
                    timestamp: Date.now()
                })
            };
            updateData[`name_${side}`] = myProfile.charId;
        }
        await window.dbUtils.updateDoc(roomRef, updateData);
    } catch (e) { console.error("joinRoom 오류:", e); }

    // UI 초기화
    ['left','right'].forEach(s => {
        const btns = document.getElementById(`btns-${s}`);
        if (btns) btns.classList.add('hidden');
        const rb = document.getElementById(`ready-btn-${s}`);
        if (rb) rb.classList.add('hidden');
        const d = document.getElementById(`dice-${s}`);
        if (d) { d.innerText = '?'; d.classList.remove('dice-rolling'); d.style.display = ''; }
        const badge = document.getElementById(`first-badge-${s}`);
        if (badge) badge.classList.add('hidden');
    });
    document.getElementById('ready-overlay')?.classList.add('hidden');

    document.getElementById('game-lobby').classList.add('hidden');
    document.getElementById('user-profile-display').classList.add('hidden');
    document.getElementById('battle-screen').classList.remove('hidden');
    startRealtimeUpdate(roomId);
}

// ═══════════════════════════════════════════
// [5] 다이스 굴리기
// ═══════════════════════════════════════════
async function rollDice(side) {
    if (myProfile.side !== side && myProfile.type !== "ADMIN") {
        alert("본인의 다이스만 굴릴 수 있습니다!"); return;
    }
    if (!currentRoomId) return;
    const roomRef = window.dbUtils.doc(window.db, "rooms", currentRoomId);
    const snap    = await window.dbUtils.getDoc(roomRef);
    if (!snap.exists()) return;
    const d = snap.data();
    if (d.status !== "fighting") { alert("전투 시작 후 굴릴 수 있습니다!"); return; }
    if (d[`dice_${side}`] > 0)   { alert("이미 굴렸습니다!"); return; }
    if (d.phase !== "dice")       { return; }

    document.getElementById(`dice-${side}`).classList.add('dice-rolling');
    const result = Math.floor(Math.random() * 100) + 1;
    setTimeout(async () => {
        await window.dbUtils.updateDoc(roomRef, { [`dice_${side}`]: result });
    }, 500);
}

// ═══════════════════════════════════════════
// [레디] 토글
// ═══════════════════════════════════════════
async function toggleReady(side) {
    if (myProfile.side !== side || !currentRoomId) return;
    const roomRef = window.dbUtils.doc(window.db, "rooms", currentRoomId);
    const snap    = await window.dbUtils.getDoc(roomRef);
    if (!snap.exists()) return;
    const cur = snap.data()[`ready_${side}`] || false;
    await window.dbUtils.updateDoc(roomRef, { [`ready_${side}`]: !cur });
}

// ═══════════════════════════════════════════
// [6] 선공 판정 (left 측만 실행해 중복 방지)
// ═══════════════════════════════════════════
async function determineTurnOrder(data) {
    if (data.isDetermined) return;
    const isLeftFirst = data.dice_left >= data.dice_right;
    const first  = isLeftFirst ? "left" : "right";
    const wName  = (isLeftFirst ? data.name_left  : data.name_right).split('|')[0];
    const lName  = (isLeftFirst ? data.name_right : data.name_left).split('|')[0];
    const roomRef = window.dbUtils.doc(window.db, "rooms", currentRoomId);
    await window.dbUtils.updateDoc(roomRef, {
        isDetermined: true,
        firstSide: first,
        turnFirst: first,
        phase: "turn_a",
        action_first: "",
        action_second: "",
        messages: window.dbUtils.arrayUnion({
            sender: "시스템",
            text: `🎲 ${wName}(${data.dice_left}) vs ${lName}(${data.dice_right}) → ${wName} 선공!`,
            timestamp: Date.now()
        })
    });
}

// ═══════════════════════════════════════════
// [전투] 행동 선택
// 선행자(turnFirst)가 먼저 선택 → 후행자가 반응 선택 → 계산
// ═══════════════════════════════════════════
async function selectAction(action) {
    if (!currentRoomId) return;
    const side = myProfile.side;
    if (side !== 'left' && side !== 'right') return;

    const roomRef = window.dbUtils.doc(window.db, "rooms", currentRoomId);
    let shouldResolve = false;
    let resolveData   = null;

    try {
        await window.dbUtils.runTransaction(window.db, async (tx) => {
            const snap = await tx.get(roomRef);
            if (!snap.exists()) throw new Error("방 없음");
            const d = snap.data();

            if (d.status !== 'fighting') throw new Error("전투 중 아님");
            if (!['turn_a','turn_b'].includes(d.phase)) throw new Error("행동 불가 페이즈");
            if (action === '도주' && (d.currentRound || 1) < 3) throw new Error("도주_불가");

            const iAmFirst = d.turnFirst === side;

            if (iAmFirst) {
                if (d.action_first) throw new Error("이미_선택");
                tx.update(roomRef, {
                    action_first: action,
                    messages: window.dbUtils.arrayUnion({
                        sender: "시스템",
                        text: `${myProfile.name} 님이 행동을 선택했습니다. 상대방의 반응을 기다리는 중...`,
                        timestamp: Date.now()
                    })
                });
            } else {
                if (!d.action_first) throw new Error("상대_미선택");
                if (d.action_second) throw new Error("이미_선택");
                tx.update(roomRef, { action_second: action });
                shouldResolve = true;
                resolveData   = { ...d, action_second: action };
            }
        });
    } catch (e) {
        if (e.message === "도주_불가")   { alert("도주는 3라운드부터 가능합니다!"); return; }
        if (e.message === "이미_선택")   { alert("이미 행동을 선택했습니다!"); return; }
        if (e.message === "상대_미선택") { alert("선공이 먼저 행동을 선택해야 합니다!"); return; }
        console.error("selectAction 오류:", e); return;
    }

    // 버튼 즉시 비활성 (내 버튼만)
    const btns = document.getElementById(`btns-${side}`);
    if (btns) btns.querySelectorAll('button').forEach(b => {
        b.disabled      = true;
        b.style.opacity = b.textContent.trim() === action ? '1' : '0.3';
        b.style.outline = b.textContent.trim() === action ? '3px solid white' : '';
    });

    if (shouldResolve && resolveData) {
        await resolveTurn(resolveData, roomRef);
    }
}

// ═══════════════════════════════════════════
// [전투] 한 턴 결과 계산
// ═══════════════════════════════════════════
async function resolveTurn(data, roomRef) {
    const turnFirst  = data.turnFirst;
    const turnSecond = turnFirst === 'left' ? 'right' : 'left';
    const aFirst     = data.action_first;
    const aSecond    = data.action_second;
    const nameFirst  = data[`name_${turnFirst}`].split('|')[0];
    const nameSecond = data[`name_${turnSecond}`].split('|')[0];
    const round      = data.currentRound || 1;
    const phase      = data.phase;
    const ts         = Date.now();

    let hp_first  = data[`hp_${turnFirst}`];
    let hp_second = data[`hp_${turnSecond}`];

    const logs    = [];
    const motions = [];
    const icon    = { '공격':'⚔️', '방어':'🛡️', '회피':'💨', '도주':'🏃' };

    logs.push(`${icon[aFirst]||''} ${nameFirst}의 행동: ${aFirst}`);
    logs.push(`${icon[aSecond]||''} ${nameSecond}의 행동: ${aSecond}`);

    // ── 결과 계산 ──
    if (aFirst === '공격' && aSecond === '공격') {
        const atkF = rollAttack();
        hp_second = Math.max(0, hp_second - atkF);
        motions.push({ side: turnFirst,  anim: 'attack' });
        motions.push({ side: turnSecond, anim: 'hit', popup: `-${atkF}`, popupType: 'damage' });
        logs.push(`결과: ${nameFirst} 공격 ${atkF} → ${nameSecond} -${atkF}HP`);
        if (hp_second > 0) {
            const atkS = rollAttack();
            hp_first = Math.max(0, hp_first - atkS);
            motions.push({ side: turnSecond, anim: 'attack' });
            motions.push({ side: turnFirst,  anim: 'hit', popup: `-${atkS}`, popupType: 'damage' });
            logs.push(`결과: ${nameSecond} 반격 ${atkS} → ${nameFirst} -${atkS}HP`);
        } else {
            logs.push(`결과: ${nameSecond} 쓰러져 반격 불가!`);
        }
    } else if (aFirst === '공격' && aSecond === '방어') {
        const atk = rollAttack(), def = rollDefense(), dmg = Math.max(0, atk - def);
        hp_second = Math.max(0, hp_second - dmg);
        motions.push({ side: turnFirst,  anim: 'attack' });
        motions.push({ side: turnSecond, anim: 'defend', popup: dmg > 0 ? `-${dmg}` : '막음!', popupType: dmg > 0 ? 'damage' : 'defend' });
        logs.push(dmg > 0
            ? `결과: 공격 ${atk} - 방어 ${def} = ${dmg} 데미지 → ${nameSecond} -${dmg}HP`
            : `결과: 공격 ${atk} - 방어 ${def} → 완전히 막아냈습니다!`);
    } else if (aFirst === '방어' && aSecond === '공격') {
        const atk = rollAttack(), def = rollDefense(), dmg = Math.max(0, atk - def);
        hp_first = Math.max(0, hp_first - dmg);
        motions.push({ side: turnSecond, anim: 'attack' });
        motions.push({ side: turnFirst,  anim: 'defend', popup: dmg > 0 ? `-${dmg}` : '막음!', popupType: dmg > 0 ? 'damage' : 'defend' });
        logs.push(dmg > 0
            ? `결과: 공격 ${atk} - 방어 ${def} = ${dmg} 데미지 → ${nameFirst} -${dmg}HP`
            : `결과: 공격 ${atk} - 방어 ${def} → 완전히 막아냈습니다!`);
    } else if (aFirst === '공격' && aSecond === '회피') {
        const atk = rollAttack(), dodged = Math.random() < 0.5;
        motions.push({ side: turnFirst,  anim: 'attack' });
        motions.push({ side: turnSecond, anim: 'dodge', popup: dodged ? '회피!' : '실패!', popupType: dodged ? 'miss' : 'damage' });
        if (dodged) { logs.push(`결과: ${nameSecond} 회피 성공! (공격 ${atk} → 피해 없음)`); }
        else        { hp_second = Math.max(0, hp_second - atk); logs.push(`결과: ${nameSecond} 회피 실패! → -${atk}HP`); }
    } else if (aFirst === '회피' && aSecond === '공격') {
        const atk = rollAttack(), dodged = Math.random() < 0.5;
        motions.push({ side: turnSecond, anim: 'attack' });
        motions.push({ side: turnFirst,  anim: 'dodge', popup: dodged ? '회피!' : '실패!', popupType: dodged ? 'miss' : 'damage' });
        if (dodged) { logs.push(`결과: ${nameFirst} 회피 성공! (공격 ${atk} → 피해 없음)`); }
        else        { hp_first = Math.max(0, hp_first - atk); logs.push(`결과: ${nameFirst} 회피 실패! → -${atk}HP`); }
    } else if (aFirst === '공격' && aSecond === '도주') {
        const atk = rollAttack(), escaped = Math.random() < 0.5;
        motions.push({ side: turnSecond, anim: 'flee', popup: escaped ? '도주!' : '실패!', popupType: 'flee' });
        if (escaped) { hp_second = 0; logs.push(`결과: ${nameSecond} 도주 성공! → 패배 처리`); }
        else {
            motions.push({ side: turnFirst, anim: 'attack' });
            motions.push({ side: turnSecond, anim: 'hit', popup: `-${atk}`, popupType: 'damage' });
            hp_second = Math.max(0, hp_second - atk);
            logs.push(`결과: ${nameSecond} 도주 실패! → -${atk}HP`);
        }
    } else if (aFirst === '도주' && aSecond === '공격') {
        const atk = rollAttack(), escaped = Math.random() < 0.5;
        motions.push({ side: turnFirst, anim: 'flee', popup: escaped ? '도주!' : '실패!', popupType: 'flee' });
        if (escaped) { hp_first = 0; logs.push(`결과: ${nameFirst} 도주 성공! → 패배 처리`); }
        else {
            motions.push({ side: turnSecond, anim: 'attack' });
            motions.push({ side: turnFirst,  anim: 'hit', popup: `-${atk}`, popupType: 'damage' });
            hp_first = Math.max(0, hp_first - atk);
            logs.push(`결과: ${nameFirst} 도주 실패! → -${atk}HP`);
        }
    } else if (aFirst === '도주' && aSecond === '도주') {
        const escF = Math.random() < 0.5, escS = Math.random() < 0.5;
        motions.push({ side: turnFirst,  anim: 'flee', popup: escF ? '도주!' : '실패!', popupType: 'flee' });
        motions.push({ side: turnSecond, anim: 'flee', popup: escS ? '도주!' : '실패!', popupType: 'flee' });
        if (escF) hp_first = 0;
        if (escS) hp_second = 0;
        logs.push(`결과: ${nameFirst} 도주 ${escF?'성공':'실패'} / ${nameSecond} 도주 ${escS?'성공':'실패'}`);
    
    
    // [추가] 선공이 도주, 후공이 방어/회피일 때
    } else if (aFirst === '도주' && (aSecond === '회피' || aSecond === '방어')) {
        const escaped = Math.random() < 0.5;
        motions.push({ side: turnFirst, anim: 'flee', popup: escaped ? '도주!' : '실패!', popupType: 'flee' });
        
        // 상대방의 방어/회피 모션 출력
        if (aSecond === '회피') motions.push({ side: turnSecond, anim: 'dodge' });
        if (aSecond === '방어') motions.push({ side: turnSecond, anim: 'defend' });

        if (escaped) { 
            hp_first = 0; // 도주 성공 시 즉시 HP 0 (패배 처리)
            logs.push(`결과: ${nameFirst} 도주 성공! → 전투 이탈(패배)`); 
        } else { 
            logs.push(`결과: ${nameFirst} 도주 실패! 하지만 상대가 공격하지 않아 피해는 없습니다.`); 
        }

    // [추가] 후공이 도주, 선공이 방어/회피일 때
    } else if ((aFirst === '회피' || aFirst === '방어') && aSecond === '도주') {
        const escaped = Math.random() < 0.5;
        motions.push({ side: turnSecond, anim: 'flee', popup: escaped ? '도주!' : '실패!', popupType: 'flee' });
        
        // 상대방의 방어/회피 모션 출력
        if (aFirst === '회피') motions.push({ side: turnFirst, anim: 'dodge' });
        if (aFirst === '방어') motions.push({ side: turnFirst, anim: 'defend' });

        if (escaped) { 
            hp_second = 0; // 도주 성공 시 즉시 HP 0 (패배 처리)
            logs.push(`결과: ${nameSecond} 도주 성공! → 전투 이탈(패배)`); 
        } else { 
            logs.push(`결과: ${nameSecond} 도주 실패! 하지만 상대가 공격하지 않아 피해는 없습니다.`); 
        }
    
    // [수정] 바로 위 괄호가 빠져있었습니다!
    } else {
        logs.push(`결과: 서로 맞붙지 않아 피해가 없습니다.`);
    }

    // HP를 left/right 기준으로 복원
    const hp_left  = turnFirst === 'left' ? hp_first : hp_second;
    const hp_right = turnFirst === 'left' ? hp_second : hp_first;

    const nameL    = data.name_left.split('|')[0];
    const nameR    = data.name_right.split('|')[0];
    const motionId = ts;

    // 게임 종료 판정
    const isKO       = hp_left <= 0 || hp_right <= 0;
    const isTurnBEnd = phase === 'turn_b';
    const isLastRound = isTurnBEnd && round >= 5;
    const isGameOver  = isKO || isLastRound;

    let resultMsg = [];
    logs.forEach((l, i) => resultMsg.push({ sender:"시스템", text:l, timestamp: ts + i }));

    if (isGameOver) {
        let endText = "";
        if (hp_left <= 0 && hp_right <= 0) {
            endText = "⚡ 양측 동시 전투 불능! 무승부!";
        } else if (hp_left <= 0) {
            endText = `🏆 ${nameR} 승리!`;
            motions.push({ side:'right', popup:'승리!', popupType:'win' });
        } else if (hp_right <= 0) {
            endText = `🏆 ${nameL} 승리!`;
            motions.push({ side:'left', popup:'승리!', popupType:'win' });
        } else {
            if      (hp_left > hp_right) { endText = `🏆 5라운드 종료 — ${nameL} 승리! (${hp_left} vs ${hp_right})`; motions.push({ side:'left',  popup:'승리!', popupType:'win' }); }
            else if (hp_right > hp_left) { endText = `🏆 5라운드 종료 — ${nameR} 승리! (${hp_left} vs ${hp_right})`; motions.push({ side:'right', popup:'승리!', popupType:'win' }); }
            else                          { endText = `⚡ 5라운드 종료 — 무승부! (${hp_left} vs ${hp_right})`; }
        }
        resultMsg.push({ sender:"시스템", text: endText, timestamp: ts + logs.length + 1 });
        await window.dbUtils.updateDoc(roomRef, {
            hp_left, hp_right,
            action_first: "", action_second: "",
            status: "ended",
            lastMotions: motions, lastMotionId: motionId,
            messages: window.dbUtils.arrayUnion(...resultMsg)
        });

    // ... (resolveTurn 함수의 앞부분 생략) ...

    } else if (phase === 'turn_a') {
        // turn_a 종료 → 선후공 교체하여 turn_b 시작
        const newTurnFirst     = turnFirst === 'left' ? 'right' : 'left';
        const newTurnFirstName = data[`name_${newTurnFirst}`].split('|')[0];
        resultMsg.push({ sender:"시스템", text:`↩️ 선후공 교체 — 이번엔 ${newTurnFirstName} 먼저!`, timestamp: ts + logs.length + 1 });
        await window.dbUtils.updateDoc(roomRef, {
            hp_left, hp_right,
            action_first: "", action_second: "",
            phase: "turn_b",
            turnFirst: newTurnFirst,
            lastMotions: motions, lastMotionId: motionId,
            messages: window.dbUtils.arrayUnion(...resultMsg)
        });

    } else {
        // turn_b 종료 → 다음 라운드 시작
        const nextRound = round + 1;
        const origFirst = data.firstSide;
        
        // [추가] 라운드가 홀수면 원래 선공, 짝수면 반대가 선공
        const roundStartFirst = (nextRound % 2 !== 0) ? origFirst : (origFirst === 'left' ? 'right' : 'left');
        const roundStartFirstName = data[`name_${roundStartFirst}`].split('|')[0];

        resultMsg.push({ sender:"시스템", text:`— ROUND ${nextRound} 시작 — ${roundStartFirstName} 선공`, timestamp: ts + logs.length + 1 });
        await window.dbUtils.updateDoc(roomRef, {
            hp_left, hp_right,
            action_first: "", action_second: "",
            currentRound: nextRound,
            phase: "turn_a",
            turnFirst: roundStartFirst, // 교체된 선공 적용
            lastMotions: motions, lastMotionId: motionId,
            messages: window.dbUtils.arrayUnion(...resultMsg)
        });
    }
}

// ═══════════════════════════════════════════
// [7] 실시간 업데이트
// ═══════════════════════════════════════════
function startRealtimeUpdate(roomId) {
    const roomRef = window.dbUtils.doc(window.db, "rooms", roomId);
    window.dbUtils.onSnapshot(roomRef, (docSnap) => {
        const data   = docSnap.data();
        if (!data) return;
        const side   = myProfile.side;
        const phase  = data.phase  || "dice";
        const status = data.status || "waiting";

        // ── 이름 & 이미지 ──
        ['left','right'].forEach(s => {
            const nameEl  = document.getElementById(`name-${s}`);
            const imgEl   = document.getElementById(`img-${s}`);
            const rawData = data[`name_${s}`];
            if (rawData && rawData.includes('|')) {
                const [fullName, num] = rawData.split('|');
                nameEl.innerText = fullName;
                imgEl.innerHTML  = `<img src="image/${fullName.split(' ')[0]}${num}.png" class="w-full h-full object-cover">`;
            } else {
                nameEl.innerText = rawData || "대기 중...";
                if (!rawData) imgEl.innerHTML = '<span class="text-gray-500 italic">No Image</span>';
            }
        });

        // ── 다이스 / 선공 배지 ──
        ['left','right'].forEach(s => {
            const dBox  = document.getElementById(`dice-${s}`);
            const badge = document.getElementById(`first-badge-${s}`);
            if (!dBox || !badge) return;
            if (data.isDetermined) {
                dBox.style.display = 'none';
                
                // [수정 포인트] 처음 선공(firstSide)이 아닌, 현재 턴(turnFirst)을 따라가게 함
                if (data.turnFirst === s) {
                    badge.classList.remove('hidden');
                } else {
                    badge.classList.add('hidden');
                }
            } else {
                dBox.style.display = '';
                dBox.style.opacity = status === 'fighting' ? '1' : '0.35';
                dBox.style.cursor  = status === 'fighting' ? 'pointer' : 'not-allowed';
                dBox.innerText     = data[`dice_${s}`] > 0 ? data[`dice_${s}`] : '?';
                if (data[`dice_${s}`] > 0) dBox.classList.remove('dice-rolling');
                badge.classList.add('hidden');
            }
        });

        // ── 레디 버튼 ──
        const bothJoined = data.name_left && data.name_right;
        ['left','right'].forEach(s => {
            const btn = document.getElementById(`ready-btn-${s}`);
            if (!btn) return;
            if (bothJoined && status === "waiting" && side === s) {
                btn.classList.remove('hidden');
                const isReady = data[`ready_${s}`];
                btn.textContent       = isReady ? '준비 완료' : '준비';
                btn.style.borderColor = isReady ? '#57825a' : '';
                btn.style.color       = isReady ? '#89b38c' : '';
            } else {
                btn.classList.add('hidden');
            }
        });

        // ── 레디 오버레이 ──
        const bothReady    = bothJoined && data.ready_left && data.ready_right;
        const readyOverlay = document.getElementById('ready-overlay');
        if (bothReady && status === "waiting") {
            readyOverlay?.classList.remove('hidden');
            const startBtn = document.getElementById('start-game-btn');
            if (startBtn) startBtn.classList.toggle('hidden', myProfile.type !== "ADMIN");
            const wm = document.getElementById('waiting-msg');
            if (wm) wm.style.display = myProfile.type === "ADMIN" ? 'none' : '';
        } else {
            readyOverlay?.classList.add('hidden');
        }

        // ── 선공 판정 트리거 (left 측만) ──
        if (status === 'fighting' && phase === 'dice' &&
            data.dice_left > 0 && data.dice_right > 0 && !data.isDetermined) {
            if (side === 'left') determineTurnOrder(data);
        }

        // ── 행동 버튼 ──
        ['left','right'].forEach(s => {
            const btns = document.getElementById(`btns-${s}`);
            if (!btns) return;

            const isFightingTurn = status === 'fighting' && (phase === 'turn_a' || phase === 'turn_b');

            if (isFightingTurn && side === s) {
                const iAmFirst  = data.turnFirst === s;
                const myAction  = iAmFirst ? data.action_first : data.action_second;
                const firstDone = !!data.action_first;
                // 선행자: 아직 안 선택. 후행자: 선행자가 선택 완료했고 나는 아직
                const canAct    = iAmFirst ? !myAction : (firstDone && !myAction);

                btns.classList.remove('hidden');
                btns.querySelectorAll('button').forEach((b, idx) => {
                    if (canAct) {
                        const isEscape = idx === 3;
                        b.disabled      = isEscape && (data.currentRound || 1) < 3;
                        b.style.opacity = b.disabled ? '0.4' : '1';
                        b.style.outline = '';
                    } else {
                        b.disabled = true;
                        if (myAction) {
                            b.style.opacity = b.textContent.trim() === myAction ? '1' : '0.3';
                            b.style.outline = b.textContent.trim() === myAction ? '3px solid white' : '';
                        } else {
                            // 선행자가 아직 안 골랐는데 내가 후행자인 경우 → 대기
                            b.style.opacity = '0.4';
                            b.style.outline = '';
                        }
                    }
                });
            } else {
                btns.classList.add('hidden');
                btns.querySelectorAll('button').forEach(b => {
                    b.disabled = false; b.style.opacity = '1'; b.style.outline = '';
                });
            }
        });

        // ── 모션 재생 (lastMotionId로만 판단, fighting/ended 상태일 때만) ──
        if ((status === 'fighting' || status === 'ended') && data.lastMotionId) {
            if (data.lastMotionId !== _lastMotionId) {
                _lastMotionId = data.lastMotionId;
                playMotions(data.lastMotions || []);
            }
        } else if (status === 'waiting') {
            _lastMotionId = null;
        }

        // ── HP 바 ──
        const hpL = Math.max(0, data.hp_left  ?? 100);
        const hpR = Math.max(0, data.hp_right ?? 100);
        document.getElementById('hp-left').style.width  = hpL + "%";
        document.getElementById('hp-right').style.width = hpR + "%";
        const hlt = document.getElementById('hp-left-text');
const hrt = document.getElementById('hp-right-text');
if (hlt) hlt.innerText = `${hpL} / 100`;
if (hrt) hrt.innerText = `${hpR} / 100`;
        document.getElementById('round-display').innerText = `ROUND ${data.currentRound || 1} / 5`;

        // ── 채팅 로그 ──
        if (data.messages) {
            const chatBox = document.getElementById('chat-messages');
            if (chatBox.children.length !== data.messages.length) {
                chatBox.innerHTML = "";
                data.messages.forEach(msg => {
    const log = document.createElement('div');
    log.className = "text-white py-1 border-b border-white/10";
    
    // 조건문을 나누어 시스템, 관리자, 일반 플레이어의 색상을 각각 다르게 적용합니다.
    if (msg.sender === "시스템") {
        log.innerHTML = `<span class="text-yellow-400 font-bold">[안내] ${msg.text}</span>`;
    } else if (msg.sender === "관리자") {
        // 관리자는 눈에 띄는 강렬한 빨간색
        log.innerHTML = `<span class="text-red-500 font-bold">${msg.sender}:</span> <span class="text-red-200">${msg.text}</span>`;
    } else {
        // 일반 플레이어는 통일된 녹색
        log.innerHTML = `<span class="text-green-400 font-bold">${msg.sender}:</span> ${msg.text}`;
    }
    
    chatBox.appendChild(log);
});
                chatBox.scrollTop = chatBox.scrollHeight;
            }
        }
// ── [추가] 게임 종료 결과창 (승/패 표시) ──
        const resOverlay = document.getElementById('result-overlay');
        if (status === "ended") {
            if (resOverlay) {
                resOverlay.classList.remove('hidden');

                const nameL = data.name_left ? data.name_left.split('|')[0] : '대기 중';
                const nameR = data.name_right ? data.name_right.split('|')[0] : '대기 중';
                const hpL = Math.max(0, data.hp_left ?? 0);
                const hpR = Math.max(0, data.hp_right ?? 0);

                document.getElementById('res-name-left').innerText = nameL;
                document.getElementById('res-hp-left').innerText = `HP ${hpL}`;
                document.getElementById('res-name-right').innerText = nameR;
                document.getElementById('res-hp-right').innerText = `HP ${hpR}`;

                const resTitle = document.getElementById('result-title');
                const isLeftWin = hpR <= 0 || hpL > hpR;
                const isRightWin = hpL <= 0 || hpR > hpL;

                // 무승부 판정
                if (hpL === hpR) {
                    resTitle.innerText = "무승부!";
                    resTitle.className = "text-4xl font-black mb-6 italic tracking-widest text-gray-400";
                } 
                // 관전자(ADMIN) 시점
                else if (myProfile.side === 'admin') {
                    resTitle.innerText = isLeftWin ? `${nameL} 승리!` : `${nameR} 승리!`;
                    resTitle.className = "text-3xl font-black mb-6 italic text-yellow-400";
                } 
                // 플레이어 시점 승/패 판정
                else {
                    const amIWinner = (isLeftWin && side === 'left') || (isRightWin && side === 'right');
                    if (amIWinner) {
                        resTitle.innerText = "승리!";
                        resTitle.className = "text-5xl font-black mb-6 italic tracking-widest text-yellow-400";
                    } else {
                        resTitle.innerText = "패배!";
                        resTitle.className = "text-5xl font-black mb-6 italic tracking-widest text-red-500";
                    }
                }
            }
        } else {
            if (resOverlay) resOverlay.classList.add('hidden');
        }
    }); // onSnapshot 끝
}

// ═══════════════════════════════════════════
// 모션 재생
// ═══════════════════════════════════════════
function showPopup(side, text, type) {
    const container = document.getElementById(`popup-${side}`);
    if (!container) return;
    const el = document.createElement('div');
    el.className = `combat-popup ${type}`;
    el.innerText  = text;
    el.style.left = '50%';
    el.style.top  = '40%';
    el.style.transform = 'translateX(-50%)';
    container.appendChild(el);
    setTimeout(() => el.remove(), 1200);
}

function playMotions(motions) {
    const real = motions.filter(m => m.side);
    real.forEach((m, i) => {
        setTimeout(() => {
            const imgEl = document.getElementById(`img-${m.side}`);
            if (imgEl && m.anim) {
                imgEl.classList.remove('anim-attack','anim-hit','anim-dodge','anim-defend','anim-flee');
                void imgEl.offsetWidth;
                imgEl.classList.add(`anim-${m.anim}`);
                imgEl.addEventListener('animationend', () =>
                    imgEl.classList.remove(`anim-${m.anim}`), { once: true });
            }
            if (m.popup) showPopup(m.side, m.popup, m.popupType || 'damage');
        }, i * 220);
    });
}

// ═══════════════════════════════════════════
// 기타 함수
// ═══════════════════════════════════════════
function setupChatEventListeners() {
    document.getElementById('chat-input')?.addEventListener('keypress', e => {
        if (e.key === 'Enter') sendChat();
    });
}

function listenToRoomList() {
    const roomsCol = window.dbUtils.collection(window.db, "rooms");
    window.dbUtils.onSnapshot(roomsCol, snapshot => {
        const div = document.getElementById('room-list');
        if (!div) return;
        div.innerHTML = snapshot.empty
            ? '<p class="text-center text-gray-400">생성된 방이 없습니다.</p>' : "";
        snapshot.forEach(d => {
            const rd = d.data();
            const item = document.createElement('div');
            item.className = "flex justify-between items-center bg-gray-700 p-3 mb-2 rounded hover:bg-gray-600 transition";
            item.innerHTML = `
                <div><span class="text-yellow-400 font-bold">[${rd.roomType}]</span> ${rd.roomName || d.id}</div>
                <button class="join-btn bg-green-600 px-3 py-1 rounded text-sm hover:bg-green-500">입장</button>`;
            item.querySelector('.join-btn').addEventListener('click', async () => {
                // 1. 관리자(ADMIN)는 정원 상관없이 무조건 입장(관전) 가능
                if (myProfile.type === "ADMIN") { 
                    joinRoom(d.id, "admin"); 
                    return; 
                }

                const snap = await window.dbUtils.getDoc(window.dbUtils.doc(window.db, "rooms", d.id));
                if (!snap.exists()) return;
                const sd = snap.data();

                // 2. 일반 플레이어 정원 체크: 1vs1 방이고 이미 2명이 들어왔거나, 양쪽 자리가 다 찼을 때
                if (sd.roomType === "1vs1" && (sd.playersCount >= 2 || (sd.name_left && sd.name_right))) {
                    alert("인원이 모두 차서 입장할 수 없습니다.");
                    return;
                }

                // 3. 자리가 비어있다면 입장 진행
                joinRoom(d.id, (sd.name_left?.trim()) ? "right" : "left");
            });
            div.appendChild(item);
        });
    });
}

function init() { listenToRoomList(); setupChatEventListeners(); }
window.onload = init;

window.rollDice             = rollDice;
window.createRoom           = createRoom;
window.joinRoom             = joinRoom;
window.sendChat             = sendChat;
window.selectCharacter      = selectCharacter;
window.backToLobby          = backToLobby;
window.backToCharacterSelection = backToCharacterSelection;
window.openCreateModal      = openCreateModal;
window.closeCreateModal     = closeCreateModal;
window.confirmCreateRoom    = confirmCreateRoom;
window.startGame            = startGame;
window.toggleReady          = toggleReady;
window.selectAction         = selectAction;

function openCreateModal()  { document.getElementById('create-room-modal').classList.remove('hidden'); }
function closeCreateModal() { document.getElementById('create-room-modal').classList.add('hidden'); }

async function confirmCreateRoom() {
    const titleInput = document.getElementById('room-title-input');
    const typeSelect = document.getElementById('room-type-select');
    const title = titleInput.value.trim() || "즐거운 전투";
    closeCreateModal();
    await createRoom(typeSelect.value, title);
    titleInput.value = "";
}

async function backToLobby() {
    if (!confirm("정말 전투를 포기하고 로비로 나가시겠습니까?")) return;
    if (currentRoomId) {
        const roomRef  = window.dbUtils.doc(window.db, "rooms", currentRoomId);
        const roomSnap = await window.dbUtils.getDoc(roomRef);
        if (roomSnap.exists()) {
            const d = roomSnap.data();
            const newCount = (d.playersCount || 1) - 1;
            if (newCount <= 0) {
                await window.dbUtils.deleteDoc(roomRef);
            } else {
                const upd = {
                    playersCount: newCount,
                    messages: window.dbUtils.arrayUnion({
                        sender:"시스템", text:`${myProfile.name} 님이 퇴장했습니다.`, timestamp: Date.now()
                    })
                };
                upd[`name_${myProfile.side}`] = "";
                await window.dbUtils.updateDoc(roomRef, upd);
            }
        }
    }
    currentRoomId = ""; myProfile.side = ""; _lastMotionId = null;
    document.getElementById('user-profile-display').classList.remove('hidden');
    document.getElementById('battle-screen').classList.add('hidden');
    document.getElementById('game-lobby').classList.remove('hidden');

    // [추가] 로비로 돌아갈 때 결과창 숨기기
    const resOverlay = document.getElementById('result-overlay');
    if (resOverlay) resOverlay.classList.add('hidden');
}

function backToCharacterSelection() {
    if (!confirm("캐릭터 선택창으로 돌아가시겠습니까?")) return;
    document.getElementById('user-profile-display')?.classList.add('hidden');
    document.getElementById('game-lobby').classList.add('hidden');
    document.getElementById('character-selection').classList.remove('hidden');
    myProfile = { name:"", type:"", side:"" };
}

async function sendChat() {
    const input = document.getElementById('chat-input');
    if (!input.value || !currentRoomId) return;
    await window.dbUtils.updateDoc(
        window.dbUtils.doc(window.db, "rooms", currentRoomId),
        { messages: window.dbUtils.arrayUnion({ sender: myProfile.name, text: input.value, timestamp: Date.now() }) }
    );
    input.value = "";
}

async function startGame() {
    if (!currentRoomId) return;
    _lastMotionId = null;
    ['left','right'].forEach(s => {
        const d = document.getElementById(`dice-${s}`);
        if (d) { d.style.display = ''; d.innerText = '?'; d.classList.remove('dice-rolling'); }
        document.getElementById(`first-badge-${s}`)?.classList.add('hidden');
    });
    const roomRef = window.dbUtils.doc(window.db, "rooms", currentRoomId);
    await window.dbUtils.updateDoc(roomRef, {
        status: "fighting",
        ready_left: false, ready_right: false,
        dice_left: 0, dice_right: 0,
        isDetermined: false,
        firstSide: "", turnFirst: "",
        phase: "dice",
        action_first: "", action_second: "",
        hp_left: 100, hp_right: 100,
        currentRound: 1,
        lastMotions: [], lastMotionId: 0,
        messages: window.dbUtils.arrayUnion({
            sender:"시스템", text:"⚔️ 전투 시작! 각자 다이스를 굴려 선공을 결정하세요.", timestamp: Date.now()
        })
    });
}
