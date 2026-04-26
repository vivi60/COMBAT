// [1] 전역 변수 설정
let myProfile = { name: "", type: "", side: "" }; 
let currentRoomId = ""; 

// [2] 캐릭터 선택 함수
function selectCharacter(name, isAdmin) {
    myProfile.name = name;
    myProfile.type = isAdmin ? "ADMIN" : "PLAYER";
    document.getElementById('character-selection').classList.add('hidden');
    document.getElementById('game-lobby').classList.remove('hidden');
    console.log(`${name}으로 접속했습니다.`);
}

// [3] 방 만들기 (Firestore에 새 문서 생성)
async function createRoom(type) {
    const newRoomId = "room_" + Math.floor(Math.random() * 100000);
    const roomRef = window.dbUtils.doc(window.db, "rooms", newRoomId);
    
    const initialData = {
        roomType: type,
        status: "waiting",
        hp_left: 100,
        hp_right: 100,
        dice_left: 0,
        dice_right: 0,
        playersCount: 0, 
        currentRound: 1,
        gameStarted: false,
        messages: []
    };

    await window.dbUtils.setDoc(roomRef, initialData);
    joinRoom(newRoomId, "left"); // 방 생성자는 왼쪽 팀 자동 배정
}

// [4] 방 입장 (인원수 체크 및 입퇴장 알림 포함)
async function joinRoom(roomId, side) {
    myProfile.side = side;
    currentRoomId = roomId;
    
    const roomRef = window.dbUtils.doc(window.db, "rooms", roomId);
    const roomSnap = await window.dbUtils.getDoc(roomRef);
    const currentCount = roomSnap.exists() ? (roomSnap.data().playersCount || 0) : 0;

    const updateData = {};
    updateData[`name_${side}`] = myProfile.name;
    updateData['playersCount'] = currentCount + 1;
    updateData['messages'] = window.dbUtils.arrayUnion({
        sender: "시스템",
        text: `${myProfile.name} 님이 ${side === 'left' ? '왼쪽' : '오른쪽'} 팀으로 입장했습니다.`,
        timestamp: new Date().getTime()
    });

    await window.dbUtils.updateDoc(roomRef, updateData);

    document.getElementById('game-lobby').classList.add('hidden');
    document.getElementById('battle-screen').classList.remove('hidden');
    
    startRealtimeUpdate(roomId);
}

// [5] 다이스 굴리기
async function rollDice(side) {
    if (myProfile.side !== side && myProfile.type !== "ADMIN") {
        alert("본인의 다이스만 굴릴 수 있습니다!");
        return;
    }

    const diceEl = document.getElementById(`dice-${side}`);
    diceEl.classList.add('dice-rolling');
    
    const result = Math.floor(Math.random() * 100) + 1;
    const roomRef = window.dbUtils.doc(window.db, "rooms", currentRoomId);

    await window.dbUtils.updateDoc(roomRef, {
        [`dice_${side}`]: result
    });
}

// [6] 선공 판정 전역 공유 (채팅창에 기록)
async function determineTurnOrderShared(data) {
    // 이미 선공 메시지가 있다면 중복 전송 방지
    const isAlreadyDetermined = data.messages.some(m => m.text.includes("선공입니다!"));
    if (isAlreadyDetermined) return;

    let winnerName = data.dice_left >= data.dice_right ? data.name_left : data.name_right;
    let winnerSide = data.dice_left >= data.dice_right ? "왼쪽" : "오른쪽";

    const roomRef = window.dbUtils.doc(window.db, "rooms", currentRoomId);
    await window.dbUtils.updateDoc(roomRef, {
        messages: window.dbUtils.arrayUnion({
            sender: "시스템",
            text: `다이스 결과: ${winnerName} 님이 선공입니다! (${winnerSide} 팀)`,
            timestamp: new Date().getTime()
        })
    });
}

// [7] 실시간 데이터 업데이트 (핵심 동기화 로직)
function startRealtimeUpdate(roomId) {
    const roomRef = window.dbUtils.doc(window.db, "rooms", roomId);

    window.dbUtils.onSnapshot(roomRef, (doc) => {
        const data = doc.data();
        if (!data) return;

        // 유저 이름 및 이미지 실시간 매칭
        ['left', 'right'].forEach(side => {
            const nameEl = document.getElementById(`name-${side}`);
            const imgEl = document.getElementById(`img-${side}`);
            
            if (data[`name_${side}`]) {
                nameEl.innerText = data[`name_${side}`];
                const charNum = data[`name_${side}`].replace(/[^0-9]/g, "");
                if(charNum) {
                    imgEl.innerHTML = `<img src="images/${charNum}.png" class="w-full h-full object-cover" onerror="this.style.display='none'">`;
                }
            } else {
                nameEl.innerText = "대기 중...";
                imgEl.innerHTML = '<span class="text-gray-500">No Image</span>';
            }
            
            // 다이스 값 표시
            const diceValue = data[`dice_${side}`];
            if (diceValue > 0) {
                const el = document.getElementById(`dice-${side}`);
                el.innerText = diceValue;
                el.classList.remove('dice-rolling');
            }
        });

        // 양쪽 다이스 완료 시 선공 판정 실행 및 버튼 활성화
        if (data.dice_left > 0 && data.dice_right > 0) {
            determineTurnOrderShared(data);
            const winnerSide = data.dice_left >= data.dice_right ? 'left' : 'right';
            document.getElementById(`btns-${winnerSide}`).classList.remove('hidden');
        }

        // 체력 바 및 라운드 동기화
        document.getElementById('hp-left').style.width = (data.hp_left || 100) + "%";
        document.getElementById('hp-right').style.width = (data.hp_right || 100) + "%";
        document.getElementById('round-display').innerText = `ROUND ${data.currentRound || 1} / 5`;

        // 채팅 실시간 업데이트 (시스템 메시지 노란색 강조)
        if (data.messages) {
            const chatBox = document.getElementById('chat-messages');
            if (chatBox.children.length !== data.messages.length) {
                chatBox.innerHTML = ""; 
                data.messages.forEach(msg => {
                    const log = document.createElement('div');
                    log.className = "text-white py-1 border-b border-white/10";
                    if (msg.sender === "시스템") {
                        log.innerHTML = `<span class="text-yellow-400 font-bold">[안내] ${msg.text}</span>`;
                    } else {
                        log.innerHTML = `<span class="text-blue-400 font-bold">${msg.sender}:</span> ${msg.text}`;
                    }
                    chatBox.appendChild(log);
                });
                chatBox.scrollTop = chatBox.scrollHeight;
            }
        }
    });
}

// [8] 뒤로가기 및 기권 로직
function backToCharacterSelection() {
    if (!confirm("캐릭터 선택창으로 돌아가시겠습니까?")) return;
    document.getElementById('game-lobby').classList.add('hidden');
    document.getElementById('character-selection').classList.remove('hidden');
    myProfile = { name: "", type: "", side: "" };
}

async function backToLobby() {
    if (!confirm("정말 전투를 포기하고 로비로 나가시겠습니까?")) return;
    if (currentRoomId) {
        const roomRef = window.dbUtils.doc(window.db, "rooms", currentRoomId);
        const roomSnap = await window.dbUtils.getDoc(roomRef);
        if (roomSnap.exists()) {
            const data = roomSnap.data();
            const newCount = (data.playersCount || 1) - 1;
            if (newCount <= 0) {
                await window.dbUtils.deleteDoc(roomRef); // 방에 아무도 없으면 삭제
            } else {
                const updateData = {
                    playersCount: newCount,
                    messages: window.dbUtils.arrayUnion({
                        sender: "시스템",
                        text: `${myProfile.name} 님이 퇴장했습니다.`,
                        timestamp: new Date().getTime()
                    })
                };
                updateData[`name_${myProfile.side}`] = ""; // 내 자리 비우기
                await window.dbUtils.updateDoc(roomRef, updateData);
            }
        }
    }
    currentRoomId = "";
    myProfile.side = "";
    document.getElementById('battle-screen').classList.add('hidden');
    document.getElementById('game-lobby').classList.remove('hidden');
}

// [9] 채팅 전송 함수
async function sendChat() {
    const input = document.getElementById('chat-input');
    if (!input.value || !currentRoomId) return;
    const roomRef = window.dbUtils.doc(window.db, "rooms", currentRoomId);
    await window.dbUtils.updateDoc(roomRef, {
        messages: window.dbUtils.arrayUnion({
            sender: myProfile.name,
            text: input.value,
            timestamp: new Date().getTime()
        })
    });
    input.value = "";
}

// [10] 초기화 및 리스트 로드
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

function listenToRoomList() {
    const roomsCollection = window.dbUtils.collection(window.db, "rooms");
    window.dbUtils.onSnapshot(roomsCollection, (snapshot) => {
        const roomListDiv = document.getElementById('room-list');
        if(!roomListDiv) return;
        roomListDiv.innerHTML = snapshot.empty ? '<p class="text-center text-gray-400">생성된 방이 없습니다.</p>' : "";
        snapshot.forEach((doc) => {
            const roomData = doc.data();
            const roomItem = document.createElement('div');
            roomItem.className = "flex justify-between items-center bg-gray-700 p-3 mb-2 rounded hover:bg-gray-600 transition";
            roomItem.innerHTML = `<div><span class="text-yellow-400 font-bold">[${roomData.roomType}]</span> ${doc.id}</div>
                <button onclick="joinRoom('${doc.id}', 'right')" class="bg-green-600 px-3 py-1 rounded text-sm hover:bg-green-500">입장하기</button>`;
            roomListDiv.appendChild(roomItem);
        });
    });
}

// 브라우저 닫을 때 자동 퇴장 처리
window.onbeforeunload = function() {
    if (currentRoomId) backToLobby();
};

function init() {
    initSelection();
    listenToRoomList();
}

if (document.readyState === "complete" || document.readyState === "interactive") {
    init();
} else {
    window.onload = init;
}

// 전역 윈도우 객체 할당 (HTML에서 접근 가능하도록)
window.rollDice = rollDice;
window.createRoom = createRoom;
window.joinRoom = joinRoom;
window.sendChat = sendChat;
window.backToCharacterSelection = backToCharacterSelection;
window.backToLobby = backToLobby;