// 전역 변수 설정
let myProfile = { name: "", type: "", side: "" }; // side: 'left' 또는 'right'
let currentRoomId = "room_001"; // 테스트용 방 ID

// 1. 캐릭터 선택 함수
function selectCharacter(name, isAdmin) {
    myProfile.name = name;
    myProfile.type = isAdmin ? "ADMIN" : "PLAYER";
    
    // UI 전환
    document.getElementById('character-selection').classList.add('hidden');
    document.getElementById('game-lobby').classList.remove('hidden');
    
    console.log(`${name}으로 접속했습니다.`);
}

// 2. 방 만들기 (Firebase에 문서 생성)
async function createRoom(type) {
    // 랜덤한 방 ID 생성 (예: room_12345)
    const newRoomId = "room_" + Math.floor(Math.random() * 100000);
    const roomRef = window.dbUtils.doc(window.db, "rooms", newRoomId);
    
    const initialData = {
        roomType: type,
        status: "waiting",
        hp_left: 100,
        hp_right: 100,
        dice_left: 0,
        dice_right: 0,
        currentRound: 1,
        gameStarted: false,
        messages: []
    };

    await window.dbUtils.setDoc(roomRef, initialData);
    joinRoom(newRoomId, "left"); // 생성된 새 ID로 입장
}

// 3. 방 입장 및 실시간 감시 시작
// 방 입장 시 인원수 체크 로직 추가
async function joinRoom(roomId, side) {
    myProfile.side = side;
    currentRoomId = roomId;
    
    const roomRef = window.dbUtils.doc(window.db, "rooms", roomId);
    
    // 방 데이터 가져와서 인원수 업데이트
    const roomSnap = await window.dbUtils.getDoc(roomRef);
    if (roomSnap.exists()) {
        const currentCount = roomSnap.data().playersCount || 0;
        await window.dbUtils.updateDoc(roomRef, {
            playersCount: currentCount + 1
        });
    }

    document.getElementById('game-lobby').classList.add('hidden');
    document.getElementById('battle-screen').classList.remove('hidden');
    
    startRealtimeUpdate(roomId);
    systemLog(`${side} 팀으로 입장했습니다.`);
}

// 창을 닫을 때 인원수 줄이기 (방 폭파 예비 로직)
window.onbeforeunload = async function() {
    if (currentRoomId) {
        const roomRef = window.dbUtils.doc(window.db, "rooms", currentRoomId);
        const roomSnap = await window.dbUtils.getDoc(roomRef);
        if (roomSnap.exists()) {
            const newCount = (roomSnap.data().playersCount || 1) - 1;
            if (newCount <= 0) {
                await window.dbUtils.deleteDoc(roomRef); // 0명이면 방 삭제
            } else {
                await window.dbUtils.updateDoc(roomRef, { playersCount: newCount });
            }
        }
    }
};

// 4. 다이스 굴리기 (DB 업데이트)
async function rollDice(side) {
    // 내 위치와 클릭한 다이스의 위치가 같거나, 관리자일 때만 작동
    if (myProfile.side !== side && myProfile.type !== "ADMIN") {
        alert("본인의 다이스만 굴릴 수 있습니다!");
        return;
    }

    const diceEl = document.getElementById(`dice-${side}`);
    diceEl.classList.add('dice-rolling');
    
    const result = Math.floor(Math.random() * 100) + 1;
    const roomRef = window.dbUtils.doc(window.db, "rooms", currentRoomId);

    // DB에 다이스 값 기록
    await window.dbUtils.updateDoc(roomRef, {
        [`dice_${side}`]: result
    });
}

// [추가] 1. 로비 -> 캐릭터 선택으로 돌아가기
function backToCharacterSelection() {
    if (!confirm("캐릭터 선택창으로 돌아가시겠습니까?")) return;
    
    document.getElementById('game-lobby').classList.add('hidden');
    document.getElementById('character-selection').classList.remove('hidden');
    
    // 선택했던 프로필 초기화
    myProfile = { name: "", type: "", side: "" };
}

// [추가] 2. 인게임 -> 로비로 돌아가기 (방 인원 관리 포함)
async function backToLobby() {
    if (!confirm("정말 전투를 포기하고 로비로 나가시겠습니까?")) return;

    if (currentRoomId) {
        const roomRef = window.dbUtils.doc(window.db, "rooms", currentRoomId);
        const roomSnap = await window.dbUtils.getDoc(roomRef);

        if (roomSnap.exists()) {
            const newCount = (roomSnap.data().playersCount || 1) - 1;
            
            if (newCount <= 0) {
                // 인원이 0명이면 방 삭제 (deleteDoc 사용)
                await window.dbUtils.deleteDoc(roomRef);
            } else {
                // 인원이 남아있으면 인원수만 업데이트
                await window.dbUtils.updateDoc(roomRef, { 
                    playersCount: newCount 
                });
            }
        }
    }

    // 상태 초기화 및 화면 전환
    currentRoomId = "";
    myProfile.side = "";
    document.getElementById('battle-screen').classList.add('hidden');
    document.getElementById('game-lobby').classList.remove('hidden');
}

// 실시간 업데이트에서 채팅 가져오기
function startRealtimeUpdate(roomId) {
    const roomRef = window.dbUtils.doc(window.db, "rooms", roomId);

    window.dbUtils.onSnapshot(roomRef, (doc) => {
        const data = doc.data();
        if (!data) return;

        // 다이스 업데이트
        if (data.dice_left) {
            const el = document.getElementById('dice-left');
            el.innerText = data.dice_left;
            el.classList.remove('dice-rolling');
        }
        if (data.dice_right) {
            const el = document.getElementById('dice-right');
            el.innerText = data.dice_right;
            el.classList.remove('dice-rolling');
        }

        // 선공 판정 로직 (양쪽 다 숫자가 나왔을 때)
        if (data.dice_left > 0 && data.dice_right > 0) {
            if (data.dice_left >= data.dice_right) {
                systemLog("왼쪽 팀 선공!");
                document.getElementById('btns-left').classList.remove('hidden');
            } else {
                systemLog("오른쪽 팀 선공!");
                document.getElementById('btns-right').classList.remove('hidden');
            }
        }

        // 체력 바 업데이트
        document.getElementById('hp-left').style.width = data.hp_left + "%";
        document.getElementById('hp-right').style.width = data.hp_right + "%";
        
        // 라운드 표시
        document.getElementById('round-display').innerText = `ROUND ${data.currentRound} / 5`;
        // 채팅 메시지 동기화
        if (data.messages) {
            const chatBox = document.getElementById('chat-messages');
            
            // 현재 화면에 표시된 메시지 개수와 DB의 메시지 개수가 다를 때만 업데이트
            if (chatBox.children.length !== data.messages.length) {
                chatBox.innerHTML = ""; // 기존 내용을 비우고 새로 그림
                data.messages.forEach(msg => {
                    const log = document.createElement('div');
                    log.className = "text-white py-1 border-b border-white/10";
                    // 발신자 이름에 색상을 넣어 가독성을 높였습니다.
                    log.innerHTML = `<span class="text-yellow-400 font-bold">${msg.sender}:</span> ${msg.text}`;
                    chatBox.appendChild(log);
                });
                // 새 메시지가 오면 자동으로 스크롤을 맨 아래로 내림
                chatBox.scrollTop = chatBox.scrollHeight;
            }
        }
    });
}

// 6. 채팅 전송
// 채팅 보내기 (DB에 저장)
async function sendChat() {
    const input = document.getElementById('chat-input');
    if (!input.value || !currentRoomId) return;

    const roomRef = window.dbUtils.doc(window.db, "rooms", currentRoomId);
    
    // Firestore의 arrayUnion을 사용하여 메시지 추가
    await window.dbUtils.updateDoc(roomRef, {
        messages: window.dbUtils.arrayUnion({
            sender: myProfile.name,
            text: input.value,
            timestamp: new Date().getTime()
        })
    });

    input.value = "";
}

// 시스템 로그 UI 출력
function systemLog(msg) {
    const chatBox = document.getElementById('chat-messages');
    const log = document.createElement('div');
    log.className = "text-white py-1 border-b border-white/10";
    log.innerText = msg;
    chatBox.appendChild(log);
    chatBox.scrollTop = chatBox.scrollHeight;
}

// 캐릭터 목록 초기화 (28명 + 관리자)
function initSelection() {
    const grid = document.getElementById('char-grid');
    if(!grid) return;

    for(let i=1; i<=28; i++) {
        const btn = document.createElement('div');
        btn.className = "character-card p-4 bg-gray-800 rounded text-center";
        btn.innerText = `캐릭터 ${i}`;
        btn.onclick = () => selectCharacter(`캐릭터 ${i}`, false);
        grid.appendChild(btn);
    }
    
    const adminBtn = document.createElement('div');
    adminBtn.className = "character-card p-4 bg-red-900 rounded text-center font-bold col-span-2";
    adminBtn.innerText = `관리자 (ADMIN)`;
    adminBtn.onclick = () => selectCharacter("관리자", true);
    grid.appendChild(adminBtn);
}

// Firestore에서 생성된 방 목록을 실시간으로 가져오는 함수
function listenToRoomList() {
    // 'rooms' 컬렉션 전체를 감시합니다.
    const roomsCollection = window.dbUtils.collection(window.db, "rooms");

    window.dbUtils.onSnapshot(roomsCollection, (snapshot) => {
        const roomListDiv = document.getElementById('room-list');
        roomListDiv.innerHTML = ""; // 기존 목록 초기화

        if (snapshot.empty) {
            roomListDiv.innerHTML = '<p class="text-center text-gray-400">생성된 방이 없습니다.</p>';
            return;
        }

        snapshot.forEach((doc) => {
            const roomData = doc.data();
            const roomId = doc.id;

            // 방 정보를 표시할 HTML 엘리먼트 생성
            const roomItem = document.createElement('div');
            roomItem.className = "flex justify-between items-center bg-gray-700 p-3 mb-2 rounded hover:bg-gray-600 transition";
            roomItem.innerHTML = `
                <div>
                    <span class="font-bold text-yellow-400">[${roomData.roomType || '1vs1'}]</span>
                    <span class="ml-2">${roomId}</span>
                </div>
                <button onclick="joinRoom('${roomId}', 'right')" class="bg-green-600 px-3 py-1 rounded text-sm">입장하기</button>
            `;
            roomListDiv.appendChild(roomItem);
        });
    });
}

// game.js 맨 하단

// 모든 초기화 함수를 하나로 합침
function init() {
    initSelection();   // 캐릭터 그리드 생성
    listenToRoomList(); // 방 목록 실시간 감시
}

// 기존 window.onload = init; 대신 아래 코드를 사용하면 더 확실합니다.
if (document.readyState === "complete" || document.readyState === "interactive") {
    init();
} else {
    window.onload = init;
}

// HTML 버튼들과 연결하기 위한 전역 할당
window.rollDice = rollDice;
window.createRoom = createRoom;
window.joinRoom = joinRoom; // 입장 함수도 연결 필요
window.sendChat = sendChat;
// [여기에 추가]
window.backToCharacterSelection = backToCharacterSelection;
window.backToLobby = backToLobby;