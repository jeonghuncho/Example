import cv2
import mediapipe as mp
import numpy as np
import math
import random

# --- [설정 및 색상] ---
SKELETON_COLOR = (255, 253, 0)
DRAW_GLOW_COLOR = (0, 0, 255)
GRAB_GLOW_COLOR = (0, 255, 255)
SPARK_CORE_COLOR = (255, 255, 255)
SPARK_GLOW_COLOR = (0, 165, 255)

CLEAR_BTN = (20, 20, 150, 80) 
TOO_CLOSE_THRESHOLD = 300  # 이전보다 상향 조정된 임계값
guide_visible = True       # 매뉴얼 표시 여부 변수 복구

mp_hands = mp.solutions.hands
mp_drawing = mp.solutions.drawing_utils
hands = mp_hands.Hands(min_detection_confidence=0.7, min_tracking_confidence=0.8)

class PinchSpark:
    def __init__(self, x, y):
        self.x, self.y = x, y
        angle = random.uniform(0, 2 * math.pi)
        speed = random.uniform(3, 8)
        self.vx, self.vy = math.cos(angle) * speed, math.sin(angle) * speed
        self.life = random.randint(10, 22)
        self.size = random.uniform(1.2, 2.8)

    def update(self):
        self.x += self.vx
        self.y += self.vy
        self.life -= 1
        self.vy += 0.3

    def draw_core(self, canvas):
        if self.life <= 0: return
        alpha = self.life / 22.0
        cv2.circle(canvas, (int(self.x), int(self.y)), int(self.size * alpha) + 1, SPARK_CORE_COLOR, -1)

    def draw_glow(self, canvas):
        if self.life <= 0: return
        alpha = (self.life / 22.0) * 0.7
        cv2.circle(canvas, (int(self.x), int(self.y)), int(self.size * alpha * 4) + 1, SPARK_GLOW_COLOR, -1)

def draw_guide_overlay(img):
    """중앙 안내창 UI (매뉴얼 복구)"""
    h, w, _ = img.shape
    box_w, box_h = 950, 550
    x1, y1 = (w - box_w) // 2, (h - box_h) // 2
    x2, y2 = x1 + box_w, y1 + box_h
    overlay = img.copy()
    cv2.rectangle(overlay, (x1, y1), (x2, y2), (15, 15, 15), -1)
    cv2.rectangle(overlay, (x1, y1), (x2, y2), (255, 255, 255), 4)
    cv2.addWeighted(overlay, 0.9, img, 0.1, 0, img)
    
    lines = [
        "--- HOW TO PLAY ---",
        "1. Index Finger: DRAW",
        "2. PINCH to move your art",
        "3. Open your PALM: STOP drawing",
        "4. Touch 'CLEAR': RESET",
        "",
        "SHOW YOUR HANDS TO START!"
    ]
    
    font_scale, thickness = 1.4, 3
    for i, line in enumerate(lines):
        color = (255, 255, 255) if i != 6 else (0, 255, 255)
        text_size = cv2.getTextSize(line, cv2.FONT_HERSHEY_SIMPLEX, font_scale, thickness)[0]
        cv2.putText(img, line, (x1 + (box_w - text_size[0]) // 2, y1 + 80 + (i * 65)), 
                    cv2.FONT_HERSHEY_SIMPLEX, font_scale, color, thickness)

def draw_distance_warning(img):
    """상단 경고 바 UI"""
    h, w, _ = img.shape
    overlay = img.copy()
    cv2.rectangle(overlay, (0, 0), (w, 100), (0, 0, 180), -1)
    cv2.addWeighted(overlay, 0.7, img, 0.3, 0, img)
    text = "!!! TOO CLOSE !!!"
    t_size = cv2.getTextSize(text, cv2.FONT_HERSHEY_DUPLEX, 1.5, 3)[0]
    cv2.putText(img, text, ((w - t_size[0]) // 2, 55), cv2.FONT_HERSHEY_DUPLEX, 1.5, (255, 255, 255), 3)

def get_dist(p1, p2): return math.hypot(p1[0] - p2[0], p1[1] - p2[1])

all_sparks, shapes, current_shape = [], [], []
selected_shape_idx, prev_pinch_pos = None, None

cap = cv2.VideoCapture(0)
cap.set(cv2.CAP_PROP_FRAME_WIDTH, 1280)
cap.set(cv2.CAP_PROP_FRAME_HEIGHT, 720)

while cap.isOpened():
    success, image = cap.read()
    if not success: break
    image = cv2.flip(image, 1)
    h, w, _ = image.shape
    results = hands.process(cv2.cvtColor(image, cv2.COLOR_BGR2RGB))

    display_frame = np.zeros_like(image)
    glow_canvas = np.zeros_like(image)
    core_canvas = np.zeros_like(image)
    spark_core_canvas = np.zeros_like(image)
    spark_glow_canvas = np.zeros_like(image)

    too_close = False

    if results.multi_hand_landmarks:
        guide_visible = False # 손이 보이면 매뉴얼 숨김
        for hand_landmarks in results.multi_hand_landmarks:
            wrist = hand_landmarks.landmark[0]
            index_mcp_ref = hand_landmarks.landmark[5]
            hand_size = get_dist((wrist.x*w, wrist.y*h), (index_mcp_ref.x*w, index_mcp_ref.y*h))
            
            if hand_size > TOO_CLOSE_THRESHOLD:
                too_close = True
                continue 

            mp_drawing.draw_landmarks(display_frame, hand_landmarks, mp_hands.HAND_CONNECTIONS,
                mp_drawing.DrawingSpec(color=SKELETON_COLOR, thickness=2, circle_radius=2),
                mp_drawing.DrawingSpec(color=SKELETON_COLOR, thickness=2))

            thumb_tip, index_tip = hand_landmarks.landmark[4], hand_landmarks.landmark[8]
            index_mcp, middle_mcp = hand_landmarks.landmark[6], hand_landmarks.landmark[10]
            ring_mcp, pinky_mcp = hand_landmarks.landmark[14], hand_landmarks.landmark[18]

            tx, ty = int(thumb_tip.x*w), int(thumb_tip.y*h)
            ix, iy = int(index_tip.x*w), int(index_tip.y*h)
            
            if CLEAR_BTN[0] <= ix <= CLEAR_BTN[2] and CLEAR_BTN[1] <= iy <= CLEAR_BTN[3]:
                shapes, current_shape, all_sparks = [], [], []

            dist = get_dist((tx, ty), (ix, iy))
            
            if dist < 45: # MOVE
                if current_shape: shapes.append(current_shape); current_shape = []
                if selected_shape_idx is None:
                    for i, s in enumerate(shapes):
                        if any(get_dist((ix, iy), p) < 50 for p in s): selected_shape_idx = i; break
                if selected_shape_idx is not None and prev_pinch_pos:
                    dx, dy = ix - prev_pinch_pos[0], iy - prev_pinch_pos[1]
                    shapes[selected_shape_idx] = [(p[0]+dx, p[1]+dy) for p in shapes[selected_shape_idx]]
                prev_pinch_pos = (ix, iy)
            else:
                selected_shape_idx, prev_pinch_pos = None, None
                index_up = iy < index_mcp.y * h
                others_down = (hand_landmarks.landmark[12].y > middle_mcp.y and 
                               hand_landmarks.landmark[16].y > ring_mcp.y and 
                               hand_landmarks.landmark[20].y > pinky_mcp.y)
                
                if index_up and others_down:
                    current_shape.append((ix, iy))
                    if len(current_shape) % 3 == 0:
                        for _ in range(5): all_sparks.append(PinchSpark(ix, iy))
                else:
                    if current_shape: shapes.append(current_shape); current_shape = []
    else:
        guide_visible = True # 손이 안 보이면 다시 매뉴얼 표시

    # --- 렌더링 ---
    cv2.rectangle(display_frame, (CLEAR_BTN[0], CLEAR_BTN[1]), (CLEAR_BTN[2], CLEAR_BTN[3]), (50, 50, 50), -1)
    cv2.putText(display_frame, "CLEAR", (CLEAR_BTN[0]+25, CLEAR_BTN[1]+40), 1, 1.5, (255, 255, 255), 2)

    for i, shape in enumerate(shapes):
        color = GRAB_GLOW_COLOR if i == selected_shape_idx else DRAW_GLOW_COLOR
        for j in range(1, len(shape)):
            cv2.line(glow_canvas, shape[j-1], shape[j], color, 12)
            cv2.line(core_canvas, shape[j-1], shape[j], (255, 255, 255), 4)
    for j in range(1, len(current_shape)):
        cv2.line(glow_canvas, current_shape[j-1], current_shape[j], DRAW_GLOW_COLOR, 12)
        cv2.line(core_canvas, current_shape[j-1], current_shape[j], (255, 255, 255), 4)

    all_sparks = [s for s in all_sparks if s.life > 0]
    for s in all_sparks:
        s.update(); s.draw_glow(spark_glow_canvas); s.draw_core(spark_core_canvas)

    final = cv2.addWeighted(display_frame, 1.0, cv2.GaussianBlur(spark_glow_canvas, (13,13), 0), 1.5, 0)
    final = cv2.addWeighted(final, 1.0, cv2.GaussianBlur(glow_canvas, (25,25), 0), 2.0, 0)
    final = cv2.addWeighted(final, 1.0, spark_core_canvas, 1.0, 0)
    final = cv2.addWeighted(final, 1.0, core_canvas, 1.0, 0)
    
    if guide_visible:
        draw_guide_overlay(final)
    elif too_close:
        draw_distance_warning(final)

    cv2.imshow('Real Spark Neon Drawing', final)
    if cv2.waitKey(1) & 0xFF == ord('q'): break

cap.release()
cv2.destroyAllWindows()