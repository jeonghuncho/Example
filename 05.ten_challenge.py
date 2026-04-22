import pygame
import time
import platform
import numpy as np
import os
from datetime import datetime

# --- 초기화 ---
pygame.init()
pygame.mixer.init()
width, height = 1200, 800 
screen = pygame.display.set_mode((width, height))
pygame.display.set_caption("10초를 맞춰봐!")
clock = pygame.time.Clock()

# --- 사운드 생성 ---
def create_sound(freq, duration, type='sine'):
    sample_rate = 44100
    t = np.linspace(0, duration, int(sample_rate * duration), False)
    wave = np.sin(2 * np.pi * freq * t) if type != 'pulse' else np.sin(2 * np.pi * freq * t) * (t % 0.25 < 0.1)
    wave = (wave * 12000).astype(np.int16)
    stereo_wave = np.vstack((wave, wave)).T.copy(order='C')
    return pygame.sndarray.make_sound(stereo_wave)

suspense_bgm = create_sound(60, 1.0, 'pulse')
success_snd = create_sound(880, 0.5)
fail_snd = create_sound(200, 0.5)

# --- 폰트 설정 ---
def get_font(size, bold=True):
    sys_name = platform.system()
    path = "C:/Windows/Fonts/malgunbd.ttf" if sys_name == "Windows" else "/System/Library/Fonts/AppleSDGothicNeo.ttc"
    if os.path.exists(path): return pygame.font.Font(path, size)
    return pygame.font.SysFont("malgungothic", size, bold=bold)

font_title = get_font(70)
font_sub = get_font(35)
font_rank_title = get_font(24)
font_rank_item = get_font(20, bold=False)

# --- 7세그먼트 그리기 함수 ---
def draw_7segment_digit(surf, x, y, digit, size, color):
    mapping = {
        '0': (1,1,1,1,1,1,0), '1': (0,1,1,0,0,0,0), '2': (1,1,0,1,1,0,1),
        '3': (1,1,1,1,0,0,1), '4': (0,1,1,0,0,1,1), '5': (1,0,1,1,0,1,1),
        '6': (1,0,1,1,1,1,1), '7': (1,1,1,0,0,1,0), '8': (1,1,1,1,1,1,1),
        '9': (1,1,1,1,0,1,1), ' ': (0,0,0,0,0,0,0)
    }
    segments = mapping.get(digit, (0,0,0,0,0,0,0))
    thickness = size // 10
    length = size // 2
    
    pts = [
        (x + thickness, y, length, thickness),
        (x + thickness + length, y + thickness, thickness, length),
        (x + thickness + length, y + 2*thickness + length, thickness, length),
        (x + thickness, y + 2*thickness + 2*length, length, thickness),
        (x, y + 2*thickness + length, thickness, length),
        (x, y + thickness, thickness, length),
        (x + thickness, y + thickness + length, length, thickness)
    ]
    
    bg_color = (color[0]//12, color[1]//12, color[2]//12)
    for i, p in enumerate(pts):
        pygame.draw.rect(surf, bg_color, p)
        if segments[i]:
            pygame.draw.rect(surf, color, p)

def draw_timer_7segment(surf, elapsed, cx, cy, size, color):
    s = f"{elapsed:05.2f}"
    digit_width = size // 2 + (size // 10)
    digit_spacing = size // 4
    dot_width = size // 6
    total_width = (digit_width * 4) + dot_width + (digit_spacing * 4)
    start_x = cx - (total_width // 2)
    
    current_x = start_x
    for char in s:
        if char == '.':
            dot_size = size // 8
            pygame.draw.rect(surf, color, (current_x + (digit_spacing//4), cy + size*1.1 - dot_size, dot_size, dot_size))
            current_x += dot_width + digit_spacing
        else:
            draw_7segment_digit(surf, current_x, cy, char, size, color)
            current_x += digit_width + digit_spacing

# --- 데이터 관리 로직 ---
def load_prize_image(filename, target_height):
    try:
        img = pygame.image.load(filename)
        orig_w, orig_h = img.get_size()
        ratio = target_height / orig_h
        return pygame.transform.smoothscale(img, (int(orig_w * ratio), target_height))
    except: return None

baskin_img = load_prize_image("baskin.png", 130)

def load_allowed_from_csv(filename):
    if not os.path.exists(filename): 
        return ["조정훈", "김용만", "이시헌", "김우진", "구자옥"]
    try:
        with open(filename, "r", encoding="utf-8") as f:
            return [line.strip() for line in f.readlines() if line.strip()]
    except:
        with open(filename, "r", encoding="cp949") as f:
            return [line.strip() for line in f.readlines() if line.strip()]

def get_title(name):
    titles = {"조정훈":"원장님", "김용만":"부원장님", "이시헌":"선생님", "김우진":"선생님"}
    return titles.get(name.strip(), "학생")

def load_and_rank():
    raw_data = []
    completed = {}
    if os.path.exists("completed_list.txt"):
        with open("completed_list.txt", "r", encoding="utf-8") as f:
            for line in f:
                parts = line.strip().split(",")
                if len(parts) == 3:
                    name, score, date = parts
                    raw_data.append({"name": name, "score": float(score)})
                    completed[name] = date
    raw_data.sort(key=lambda x: round(abs(10.00 - x["score"]), 2))
    ranked_list = []
    current_rank = 1
    for i in range(len(raw_data)):
        if i > 0:
            prev_diff = round(abs(10.00 - raw_data[i-1]["score"]), 2)
            curr_diff = round(abs(10.00 - raw_data[i]["score"]), 2)
            if curr_diff > prev_diff:
                current_rank = i + 1
        entry = raw_data[i].copy()
        entry["rank"] = current_rank
        ranked_list.append(entry)
    return completed, ranked_list[:10]

def save_score(name, score):
    date_str = datetime.now().strftime("%m/%d")
    with open("completed_list.txt", "a", encoding="utf-8") as f:
        f.write(f"{name},{score:.2f},{date_str}\n")
    return date_str

# --- 설정 및 초기화 ---
BLACK, WHITE, RED, GOLD, GRAY = (15, 15, 25), (255, 255, 255), (255, 0, 0), (237, 184, 73), (200, 200, 200)

ALLOWED_STUDENTS = load_allowed_from_csv("students.csv")
completed_dict, top10_list = load_and_rank()
state, user_input, editing_text, current_player, elapsed, start_time = -1, "", "", "", 0, 0
error_msg = ""

# 초기 텍스트 입력 시작
pygame.key.start_text_input()
running = True

# --- 메인 루프 ---
while running:
    bg_color = BLACK if state == -1 else WHITE
    screen.fill(bg_color)
    
    for event in pygame.event.get():
        if event.type == pygame.QUIT: running = False
        
        if state == -1: # 입력 화면
            if event.type == pygame.TEXTINPUT: 
                # 글자가 확정되면 user_input에 더하고 editing_text는 초기화
                user_input += event.text
                editing_text = ""
            elif event.type == pygame.TEXTEDITING:
                # 조합 중인 텍스트 실시간 저장
                editing_text = event.text
            elif event.type == pygame.KEYDOWN:
                if event.key == pygame.K_RETURN:
                    # 최종 이름은 완성된 글자와 조합 중인 글자의 합
                    final_name = (user_input + editing_text).strip()
                    if final_name in ALLOWED_STUDENTS:
                        if final_name not in completed_dict:
                            current_player = final_name; state = 0; error_msg = ""; user_input = ""; editing_text = ""
                            pygame.key.stop_text_input() # 입력 종료
                        else:
                            error_msg = f"'{final_name}'님은 이미 참여했습니다."
                    elif final_name:
                        error_msg = f"'{final_name}'님은 명단에 없습니다."
                elif event.key == pygame.K_BACKSPACE: 
                    if editing_text: 
                        # 조합 중인 글자가 있으면 그것부터 지워지도록 유도 (시스템 기본동작 보조)
                        editing_text = "" 
                    else:
                        user_input = user_input[:-1]
        
        else: # 게임 화면 (0: 준비, 1: 진행, 2: 결과)
            if event.type == pygame.KEYDOWN and event.key == pygame.K_SPACE:
                if state == 0: 
                    state = 1; start_time = time.time(); suspense_bgm.play(-1)
                elif state == 1: 
                    state = 2; elapsed = time.time() - start_time; suspense_bgm.stop()
                    save_score(current_player, elapsed)
                    completed_dict, top10_list = load_and_rank() 
                    if round(elapsed, 2) == 10.00: success_snd.play()
                    else: fail_snd.play()
                elif state == 2: 
                    # 게임 종료 후 다시 입력 상태로 돌아갈 때 초기화 로직 강화
                    state = -1; elapsed = 0; current_player = ""; user_input = ""; editing_text = ""; error_msg = ""
                    pygame.key.start_text_input() # 입력기 다시 활성화

    # --- 렌더링 ---
    if state == -1:
        title_surf = font_title.render("10초를 맞춰봐!", True, WHITE)
        screen.blit(title_surf, (width//2 - title_surf.get_width()//2, 80))
        sub_msg = font_sub.render("도전자 이름을 입력하세요.", True, WHITE)
        screen.blit(sub_msg, (width//2 - sub_msg.get_width()//2, 200))
        
        input_rect = pygame.Rect(width//2 - 200, 260, 400, 80)
        pygame.draw.rect(screen, (30, 30, 50), input_rect, border_radius=10)
        pygame.draw.rect(screen, GOLD, input_rect, 3, border_radius=10)
        
        # 화면 표시용 텍스트 (확정문구 + 조합중문구)
        full_display_name = user_input + editing_text
        
        # 커서 깜빡임 로직
        cursor = "|" if int(time.time() * 2) % 2 == 0 else ""
        
        input_surf = font_sub.render(full_display_name + cursor, True, WHITE)
        screen.blit(input_surf, (input_rect.centerx - input_surf.get_width()//2, input_rect.centery - input_surf.get_height()//2))
        
        if error_msg:
            err_surf = font_rank_item.render(error_msg, True, (255, 100, 100))
            screen.blit(err_surf, (width//2 - err_surf.get_width()//2, 360))

        prize_txt = font_sub.render("상품: 배스킨라빈스 기프티콘", True, GOLD)
        screen.blit(prize_txt, (width//2 - prize_txt.get_width()//2 - 40, 420))
        if baskin_img:
            screen.blit(baskin_img, (width//2 + 150, 380))
            
    else:
        p_info = f"도전자: {current_player} {get_title(current_player)}"
        p_surf = font_sub.render(p_info, True, (50, 50, 50))
        screen.blit(p_surf, (40, 40))
        
        timer_box = pygame.Rect(width//2 - 350, 180, 700, 240)
        pygame.draw.rect(screen, (10, 10, 10), timer_box, border_radius=20)
        
        if state == 1: elapsed = time.time() - start_time
        draw_timer_7segment(screen, elapsed, width//2, 220, 120, RED)
        
        guide = "[SPACE] 눌러서 시작!" if state == 0 else "[SPACE] 눌러서 멈추기!"
        if state == 2:
            res = "★ PERFECT 10.00 ★" if round(elapsed, 2) == 10.00 else "MISSION FAILED"
            guide = f"{res} (다음 학생을 위해 [SPACE]를 눌러주세요.)"
        g_surf = font_sub.render(guide, True, (100, 100, 100))
        screen.blit(g_surf, (width//2 - g_surf.get_width()//2, 450))

    # --- 하단 랭킹 ---
    rank_y = height - 250
    pygame.draw.rect(screen, (25, 25, 35), (0, rank_y, width, 250))
    pygame.draw.line(screen, GOLD, (0, rank_y), (width, rank_y), 5)
    rtitle = font_rank_title.render("◈ 실시간 명예의 전당 TOP 10 ◈", True, GOLD)
    screen.blit(rtitle, (width//2 - rtitle.get_width()//2, rank_y + 15))

    if top10_list:
        col1_x, col2_x = 100, 640
        for i, data in enumerate(top10_list):
            column_x = col1_x if i < 5 else col2_x
            row_index = i % 5
            item_y = rank_y + 70 + (row_index * 35)
            
            rank_color = RED if data['rank'] <= 3 else GOLD
            diff = abs(10.00 - data['score'])
            score_color = (0, 255, 0) if round(diff, 2) == 0 else WHITE
            
            rank_surf = font_rank_item.render(f"{data['rank']}위", True, rank_color)
            screen.blit(rank_surf, (column_x, item_y))
            
            name_surf = font_rank_item.render(f"{data['name']}", True, WHITE)
            screen.blit(name_surf, (column_x + 80, item_y))
            
            score_surf = font_rank_item.render(f"{data['score']:.2f}초", True, score_color)
            screen.blit(score_surf, (column_x + 280, item_y))
            
    else:
        empty_txt = font_rank_item.render("아직 기록이 없습니다. 도전해보세요!", True, GRAY)
        screen.blit(empty_txt, (width//2 - empty_txt.get_width()//2, rank_y + 110))

    pygame.display.flip()
    clock.tick(60)

pygame.quit()