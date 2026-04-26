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
    const roomRef = window.dbUtils.doc(window.db, "rooms", currentRoomId);
    
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
    joinRoom(currentRoomId, "left"); // 방 만든 사람은 기본적으로 왼쪽
}

// 3. 방 입장 및 실시간 감시 시작
function joinRoom(roomId, side) {
    myProfile.side = side;
    currentRoomId = roomId;
    
    document.getElementById('game-lobby').classList.add('hidden');
    document.getElementById('battle-screen').classList.remove('hidden');
    
    // 실시간 감시(onSnapshot) 시작
    startRealtimeUpdate(roomId);
    systemLog(`${side} 팀으로 입장했습니다.`);
}

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

// 5. 실시간 데이터 동기화 (핵심)
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
    });
}

// 6. 채팅 전송
async function sendChat() {
    const input = document.getElementById('chat-input');
    if (!input.value) return;

    const roomRef = window.dbUtils.doc(window.db, "rooms", currentRoomId);
    const newMessage = `${myProfile.name}: ${input.value}`;

    // 실제로는 arrayUnion을 써야 하지만, 간단하게 구현 위해 텍스트 로그로 대체
    systemLog(newMessage);
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

// 페이지가 로드될 때 방 목록 감시 시작
// 기존 window.onload 에 추가하거나 별도로 실행
const originalOnload = window.onload;
window.onload = function() {
    if(originalOnload) originalOnload();
    listenToRoomList();
};

// 페이지 로드 시 실행
window.onload = initSelection;

// HTML 버튼들과 연결하기 위해 함수들을 window에 할당
window.rollDice = rollDice;
window.createRoom = createRoom;
window.sendChat = sendChat;