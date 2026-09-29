"""批量建模全部地标 → public/models/legacy/*.glb
运行: blender -b -P build_all.py
"""
import bpy, sys, os, math
sys.path.append(os.path.dirname(os.path.abspath(__file__)))
import cnroof as cn

OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "public", "models", "legacy")
os.makedirs(OUT, exist_ok=True)

def reset():
    bpy.ops.object.select_all(action='DESELECT')
    for o in list(bpy.data.objects):
        bpy.data.objects.remove(o, do_unlink=True)

def save(name, objs):
    main = cn.join_objs(objs, name)
    tris = len(main.data.polygons)
    cn.export_glb(os.path.join(OUT, f"{name}.glb"))
    reset()
    print(f"[{name}] triangles={tris}")

# ═══ 太和殿 ═══
def taihedian():
    W, D = 60.0, 33.0
    objs = []
    terr, tz = cn.terrace(78, 50, tiers=3, tier_h=2.6, inset=1.7, mat=cn.M['marble'])
    objs += terr
    body, bz = cn.hall_body(W, D, n_bays_x=11, n_bays_z=5, col_h=9.0, col_r=0.5,
                            mat_wall=cn.M['red'], mat_paint=cn.M['caihua'])
    for o in body: o.location.z += tz
    objs += body
    lower = cn.hip_roof(66, 39, 4.2, top_w=48, top_d=24, flare=0.9, mat=cn.M['gold'], name="lower_eave")
    lower.location.z = tz + bz
    objs.append(lower)
    upper_walls = cn.box("upper_walls", 45, 22, 4.5, 0, 0, tz + bz + 4.0, cn.M['red'])
    objs.append(upper_walls)
    z3 = tz + bz + 4.2
    ub, uz = cn.hall_body(46, 24, n_bays_x=9, n_bays_z=4, col_h=4.4, col_r=0.42,
                          mat_wall=cn.M['red'], mat_paint=cn.M['caihua'])
    for o in ub: o.location.z += z3
    objs += ub
    upper = cn.hip_roof(48, 25, 12.0, top_w=26.5, top_d=0.0, flare=1.5, mat=cn.M['gold'], name="upper_roof")
    upper.location.z = z3 + uz
    objs.append(upper)
    objs += cn.ridge_ornaments(27, z3 + uz + 12.0 - 0.2, cn.M['dark'])
    for sx in (-1, 1):
        objs.append(cn.box("pav", 12, 10, 5, sx * 36, 0, tz, cn.M['red']))
        r = cn.hip_roof(14, 12, 4.0, top_w=5, top_d=0, flare=1.2, mat=cn.M['gold'], name="pav_roof")
        r.location = (sx * 36, 0, tz + 5)
        objs.append(r)
    save("taihedian", objs)

# ═══ 祈年殿 ═══
def qiniandian():
    objs = []
    terr, tz = cn.circular_terrace(40, tiers=3, tier_h=2.4, inset=3.0, mat=cn.M['marble'])
    objs += terr
    # 殿身: 红色圆柱体 + 金边 + 彩画环带
    body = cn.cyl("body", 15.5, 10.5, 0, 0, tz, 48, cn.M['red'])
    objs.append(body)
    objs.append(cn.cyl("body_trim", 15.9, 0.5, 0, 0, tz + 9.2, 48, cn.M['goldbright']))
    # 彩画环带 (3 条, 对应各层檐下)
    bands = [(17.4, 2.0, tz + 10.5), (14.6, 1.9, tz + 16.0), (11.6, 1.8, tz + 21.3)]
    for r, hh, zz in bands:
        objs.append(cn.cyl("band", r, hh, 0, 0, zz, 48, cn.M['caihua']))
    # 宝顶
    objs.append(cn.cyl("finial_base", 1.6, 1.0, 0, 0, tz + 27.4, 16, cn.M['goldbright']))
    fin = cn.cyl("finial", 1.1, 2.6, 0, 0, tz + 28.4, 16, cn.M['goldbright'])
    objs.append(fin)
    top = cn.cyl("finial_top", 0.35, 1.4, 0, 0, tz + 31.0, 12, cn.M['goldbright'])
    objs.append(top)
    save("qiniandian", objs)

# ═══ 城楼类 (天安门/正阳门/神武门/东华门/西华门/永定门) ═══
def gate(name, podium_w, podium_d, podium_h, hall_w, hall_h, roof_h=4.0, mat_roof=None):
    objs = []
    objs.append(cn.box("podium", podium_w, podium_d, podium_h, 0, 0, 0, cn.M['red']))
    # 城台顶面白石护栏
    objs.append(cn.box("rail", podium_w + 1.0, podium_d + 1.0, 0.7, 0, 0, podium_h, cn.M['marble']))
    # 城楼
    objs.append(cn.box("tower", hall_w, hall_w * 0.42, hall_h, 0, 0, podium_h + 0.7, cn.M['red']))
    tz = podium_h + 0.7 + hall_h
    # 柱廊暗示: 前脸柱
    n = max(6, int(hall_w / 4))
    for i in range(n):
        x = -hall_w / 2 + i * hall_w / (n - 1)
        objs.append(cn.cyl("gc", 0.45, hall_h, x, hall_w * 0.42 / 2 + 0.3, podium_h + 0.7, 10, cn.M['redwood']))
    # 彩画带
    objs.append(cn.box("gcai", hall_w + 0.4, hall_w * 0.42 + 0.4, 0.7, 0, 0, tz, cn.M['caihua']))
    # 双重檐
    r1 = cn.hip_roof(hall_w + 6, hall_w * 0.42 + 6, roof_h * 0.55,
                     top_w=hall_w * 0.62, top_d=hall_w * 0.42 * 0.6, flare=1.1, mat=mat_roof, name="groof1")
    r1.location.z = tz + 0.7
    objs.append(r1)
    z2 = tz + 0.7 + roof_h * 0.55
    objs.append(cn.box("gneck", hall_w * 0.55, hall_w * 0.42 * 0.55, roof_h * 0.35, 0, 0, z2, cn.M['red']))
    r2 = cn.hip_roof(hall_w * 0.62, hall_w * 0.42 * 0.62, roof_h,
                     top_w=hall_w * 0.3, top_d=0.0, flare=1.4, mat=mat_roof, name="groof2")
    r2.location.z = z2 + roof_h * 0.35
    objs.append(r2)
    objs += cn.ridge_ornaments(hall_w * 0.3, z2 + roof_h * 0.35 + roof_h - 0.3, cn.M['dark'])
    save(name, objs)

# ═══ 午门 ═══
def wumen():
    objs = []
    # 主城台 (U形: 正楼+四座亭式楼阁)
    objs.append(cn.box("podium", 126, 30, 18, 0, 0, 0, cn.M['red']))
    for sx in (-1, 1):
        objs.append(cn.box("wing", 26, 34, 26, sx * 74, -2, 0, cn.M['red']))
    objs.append(cn.box("rail", 128, 32, 0.7, 0, 0, 18, cn.M['marble']))
    # 正楼
    objs.append(cn.box("hall", 62, 18, 12, 0, 0, 18.7, cn.M['red']))
    r1 = cn.hip_roof(66, 22, 5.0, top_w=40, top_d=8, flare=1.2, mat=cn.M['gold'], name="wroof1")
    r1.location.z = 30.7
    objs.append(r1)
    objs.append(cn.box("wneck", 38, 9, 3.0, 0, 0, 35.7, cn.M['red']))
    r2 = cn.hip_roof(40, 12, 6.5, top_w=18, top_d=0, flare=1.4, mat=cn.M['gold'], name="wroof2")
    r2.location.z = 38.7
    objs.append(r2)
    objs += cn.ridge_ornaments(18, 45.2 - 0.3, cn.M['dark'])
    # 两侧雁翅楼亭
    for sx in (-1, 1):
        objs.append(cn.box("feng", 14, 14, 10, sx * 74, 0, 26.7, cn.M['red']))
        rf = cn.hip_roof(17, 17, 5.5, top_w=6, top_d=0, flare=1.3, mat=cn.M['gold'], name="froof")
        rf.location = (sx * 74, 0, 36.7)
        objs.append(rf)
        objs.append(cn.box("feng2", 12, 12, 9, sx * 74, -22, 26.7, cn.M['red']))
        rf2 = cn.hip_roof(15, 15, 5.0, top_w=5, top_d=0, flare=1.3, mat=cn.M['gold'], name="froof2")
        rf2.location = (sx * 74, -22, 35.7)
        objs.append(rf2)
    save("wumen", objs)

# ═══ 角楼 ═══
def jiaolou():
    objs = []
    # 城墙段基座 (十字相交的城墙角)
    objs.append(cn.box("wallx", 34, 9, 9.6, 0, 0, 0, cn.M['red']))
    objs.append(cn.box("wally", 9, 34, 9.6, 0, 0, 0, cn.M['red']))
    # 三重檐十字脊亭
    objs.append(cn.box("body", 13, 13, 6, 0, 0, 9.6, cn.M['red']))
    z = 15.6
    for i, s in enumerate([16, 11, 6.5]):
        r = cn.hip_roof(s, s, 3.2 - i * 0.3, top_w=s * 0.5, top_d=s * 0.5, flare=1.5, mat=cn.M['green'], name=f"jr{i}")
        r.location.z = z
        objs.append(r)
        z += 2.1
    # 十字脊端部小尖
    for dx, dy in ((1, 0), (-1, 0), (0, 1), (0, -1)):
        objs.append(cn.cyl("jspire", 0.25, 2.2, dx * 7.5, dy * 7.5, z + 0.6, 8, cn.M['goldbright']))
    objs.append(cn.cyl("jtop", 0.3, 2.6, 0, 0, z + 0.4, 8, cn.M['goldbright']))
    save("jiaolou", objs)

# ═══ 鼓楼 / 钟楼 ═══
def gulou():
    objs = []
    objs.append(cn.box("podium", 56, 33, 24, 0, 0, 0, cn.M['gray']))
    objs.append(cn.box("arch", 14, 33.2, 11, 0, 0, 0, cn.M['dark']))  # 卷门洞(穿通)
    objs.append(cn.box("hall", 44, 24, 9, 0, 0, 24, cn.M['red']))
    objs.append(cn.box("gcai", 44.4, 24.4, 0.7, 0, 0, 33, cn.M['caihua']))
    r = cn.hip_roof(48, 27, 8.5, top_w=18, top_d=0, flare=1.3, mat=cn.M['green'], name="roof")
    r.location.z = 33.7
    objs.append(r)
    objs += cn.ridge_ornaments(18, 42.2 - 0.3, cn.M['dark'])
    save("gulou", objs)

def zhonglou():
    objs = []
    objs.append(cn.box("base", 36, 36, 2.2, 0, 0, 0, cn.M['marble']))
    objs.append(cn.box("podium", 32, 32, 32, 0, 0, 2.2, cn.M['gray']))
    objs.append(cn.box("arch", 10, 32.2, 13, 0, 0, 2.2, cn.M['dark']))
    objs.append(cn.box("gcai", 32.4, 32.4, 0.7, 0, 0, 34.2, cn.M['caihua']))
    r = cn.hip_roof(35, 35, 10.5, top_w=6, top_d=0, flare=1.4, mat=cn.M['dark'], name="roof")
    r.location.z = 34.9
    objs.append(r)
    objs.append(cn.cyl("spire", 0.5, 6, 0, 0, 45.4, 8, cn.M['goldbright']))
    save("zhonglou", objs)

# ═══ 中国尊 ═══
def chinazun():
    objs = []
    H, SEG = 528, 44
    prof = [(0, 56), (0.16, 46), (0.30, 41), (0.48, 42.5), (0.66, 46.5), (0.84, 50), (1, 45)]
    def width_at(t):
        for i in range(1, len(prof)):
            if t <= prof[i][0]:
                t0, w0 = prof[i - 1]; t1, w1 = prof[i]
                return w0 + ((t - t0) / (t1 - t0)) * (w1 - w0)
        return prof[-1][1]
    verts, faces = [], []
    for i in range(SEG + 1):
        t = i / SEG
        w2 = width_at(t) / 2
        z = t * H
        for k in range(4):
            a = math.pi / 4 + k * math.pi / 2
            verts.append((math.cos(a) * w2 * 1.414, math.sin(a) * w2 * 1.414, z))
    for i in range(SEG):
        for k in range(4):
            a = i * 4 + k
            b = i * 4 + (k + 1) % 4
            c = (i + 1) * 4 + (k + 1) % 4
            dd = (i + 1) * 4 + k
            faces.append((a, b, c, dd))
    ob = cn.new_mesh_obj("zun", verts, faces, cn.mat_glass_grid())
    objs.append(ob)
    # 冠部
    objs.append(cn.box("crown", 34, 34, 10, 0, 0, H + 2, cn.M['glass']))
    objs.append(cn.box("crown2", 24, 24, 8, 0, 0, H + 12, cn.M['glass']))
    save("chinazun", objs)

# ═══ 央视大楼 ═══
def cctv():
    objs = []
    lean = 0.10
    t1 = cn.box("t1", 46, 56, 208, -50, 0, 0, cn.M['glass'])
    t1.rotation_euler = (0, lean, 0)
    t1.location.z = 104
    t2 = cn.box("t2", 46, 56, 208, 50, 0, 0, cn.M['glass'])
    t2.rotation_euler = (0, -lean, 0)
    t2.location.z = 104
    objs += [t1, t2]
    objs.append(cn.box("base", 150, 52, 36, 0, 0, 0, cn.M['glass']))
    top = cn.box("top", 212, 52, 50, 10, 0, 202, cn.M['glass'])
    objs.append(top)
    k1 = cn.cyl("k1", 27, 58, -90, 0, 198, 14, cn.M['glass'])
    k1.rotation_euler = (math.pi / 2, 0, 0)
    k2 = cn.cyl("k2", 27, 58, 106, 0, 198, 14, cn.M['glass'])
    k2.rotation_euler = (math.pi / 2, 0, 0)
    objs += [k1, k2]
    save("cctv", objs)

# ═══ 鸟巢 ═══
def birdnest():
    objs = []
    RX, RZ, H = 163, 108, 66
    # 外皮 (椭圆环面分层)
    rings = [(0, 1.0), (20, 1.03), (42, 0.98), (58, 0.84), (66, 0.62)]
    seg = 56
    for i in range(len(rings) - 1):
        y0, s0 = rings[i]; y1, s1 = rings[i + 1]
        verts, faces = [], []
        n2 = seg + 1
        for k in range(n2):
            a = 2 * math.pi * k / seg
            x0, z0 = math.cos(a) * RX * s0, math.sin(a) * RZ * s0
            x1, z1 = math.cos(a) * RX * s1, math.sin(a) * RZ * s1
            verts.append((x0, z0, y0))
            verts.append((x1, z1, y1))
        for k in range(seg):
            a0 = k * 2
            faces.append((a0, a0 + 1, a0 + 3, a0 + 2))
        shell = cn.new_mesh_obj(f"shell{i}", verts, faces, cn.M['steel'])
        shell.location.z = 0
        objs.append(shell)
    # 编织管: 两组交叉椭圆环管
    for i in range(26):
        r = 118 + (i % 5) * 13
        tube = cn.tube(f"tube{i}", r, 2.4 + (i % 3) * 1.2, 0, 0, 6 + (i % 4) * 20, 60, cn.M['steel'])
        tube.rotation_euler = (math.pi / 2 + ((i * 7) % 10 - 5) * 0.045, 0, (i / 26) * math.pi)
        tube.scale = (1.24, 0.83, 1)
        objs.append(tube)
    # 红色看台碗
    bowl = cn.cyl("bowl", 100, 30, 0, 0, 8, 40, cn.M['red'])
    objs.append(bowl)
    field = cn.cyl("field", 70, 1, 0, 0, 8, 32, cn.mat_simple("grass_dark", (0.13, 0.22, 0.10)))
    objs.append(field)
    save("birdnest", objs)

# ═══ 水立方 ═══
def watercube():
    objs = []
    m = cn._clear_mat("bubble")
    m.use_nodes = True
    nt = m.node_tree
    b = nt.nodes["Principled BSDF"]
    b.inputs["Base Color"].default_value = (0.16, 0.42, 0.65, 1)
    b.inputs["Roughness"].default_value = 0.15
    noise = nt.nodes.new("ShaderNodeTexNoise")
    noise.inputs["Scale"].default_value = 3.2
    noise.inputs["Detail"].default_value = 2.5
    vor = nt.nodes.new("ShaderNodeTexVoronoi")
    vor.inputs["Scale"].default_value = 5.5
    bump = nt.nodes.new("ShaderNodeBump")
    bump.inputs["Strength"].default_value = 0.35
    nt.links.new(vor.outputs["Distance"], bump.inputs["Height"])
    nt.links.new(bump.outputs["Normal"], b.inputs["Normal"])
    objs.append(cn.box("wcube", 177, 177, 31, 0, 0, 0, m))
    objs.append(cn.box("wtrim", 179, 179, 1.2, 0, 0, 30.6, cn.M['white']))
    save("watercube", objs)

# ═══ 国家大剧院 ═══
def ncpa():
    objs = []
    bpy.ops.mesh.primitive_uv_sphere_add(radius=1, segments=48, ring_count=28, location=(0, 0, 6))
    egg = bpy.context.active_object
    egg.scale = (106, 73, 46)
    bpy.ops.object.transform_apply(scale=True)
    egg.name = "egg"
    egg.data.materials.append(cn.M['titan'])
    objs.append(egg)
    # 玻璃前厅 (南北端)
    g = cn.mat_simple("egg_glass", (0.35, 0.5, 0.58), rough=0.1, metal=0.5)
    bpy.ops.mesh.primitive_uv_sphere_add(radius=1, segments=32, ring_count=20, location=(0, 0, 6))
    glass = bpy.context.active_object
    glass.scale = (103, 70, 44)
    bpy.ops.object.transform_apply(scale=True)
    glass.name = "egg_glass"
    glass.data.materials.append(g)
    objs.append(glass)
    pool = cn.cyl("pool", 165, 0.6, 0, 0, 0.2, 48, cn.mat_simple("pool", (0.10, 0.25, 0.38), rough=0.08))
    objs.append(pool)
    save("ncpa", objs)

# ═══ 国贸三期 ═══
def guomao3():
    objs = []
    H = 330
    prof = [(0, 44), (0.55, 42), (0.86, 38), (1, 34)]
    def w_at(t):
        for i in range(1, len(prof)):
            if t <= prof[i][0]:
                t0, w0 = prof[i - 1]; t1, w1 = prof[i]
                return w0 + ((t - t0) / (t1 - t0)) * (w1 - w0)
        return prof[-1][1]
    SEG = 30
    verts, faces = [], []
    for i in range(SEG + 1):
        t = i / SEG
        w2 = w_at(t) / 2
        for k in range(4):
            a = math.pi / 4 + k * math.pi / 2
            verts.append((math.cos(a) * w2 * 1.414, math.sin(a) * w2 * 1.414, t * H * 0.86))
    for i in range(SEG):
        for k in range(4):
            a = i * 4 + k
            b = i * 4 + (k + 1) % 4
            c = (i + 1) * 4 + (k + 1) % 4
            dd = (i + 1) * 4 + k
            faces.append((a, b, c, dd))
    objs.append(cn.new_mesh_obj("gm3", verts, faces, cn.mat_glass_grid(scale=2.2)))
    objs.append(cn.box("gm3crown", 52, 52, 12, 0, 0, H * 0.86, cn.M['dark']))
    objs.append(cn.box("gm3top", 30, 30, 32, 0, 0, H * 0.86 + 12, cn.M['glass']))
    save("guomao3", objs)

# ═══ 天安门 ═══
def tiananmen():
    # 城台 118×38×12, 城楼 56×21×13, 通高34.7
    gate("tiananmen", 118, 38, 11.5, 56, 12.5, roof_h=4.2, mat_roof=cn.M['gold'])

def zhengyangmen():
    gate("zhengyangmen", 44, 22, 13.5, 36, 12.0, roof_h=4.0, mat_roof=cn.M['green'])

def jianlou():
    # 箭楼: 城台+重檐歇山(灰瓦)
    objs = []
    objs.append(cn.box("podium", 42, 20, 12.6, 0, 0, 0, cn.M['gray']))
    objs.append(cn.box("tower", 34, 16, 14, 0, 0, 12.6, cn.M['gray']))
    objs.append(cn.box("gcai", 34.4, 16.4, 0.6, 0, 0, 26.6, cn.M['caihua']))
    r1 = cn.hip_roof(38, 20, 3.4, top_w=26, top_d=10, flare=1.0, mat=cn.M['dark'], name="r1")
    r1.location.z = 27.2
    objs.append(r1)
    r2 = cn.hip_roof(27, 11, 5.5, top_w=10, top_d=0, flare=1.3, mat=cn.M['dark'], name="r2")
    r2.location.z = 30.6
    objs.append(r2)
    save("jianlou", objs)

def yongdingmen():
    gate("yongdingmen", 40, 18, 12.5, 32, 11.0, roof_h=4.0, mat_roof=cn.M['green'])

def shenwumen():
    gate("shenwumen", 62, 22, 10.5, 40, 9.5, roof_h=4.2, mat_roof=cn.M['gold'])

def donghuamen():
    gate("donghuamen", 46, 18, 10.0, 30, 8.5, roof_h=4.0, mat_roof=cn.M['gold'])

def xihuamen():
    gate("xihuamen", 46, 18, 10.0, 30, 8.5, roof_h=4.0, mat_roof=cn.M['gold'])

def taihemen():
    gate("taihemen", 58, 20, 8.5, 40, 9.0, roof_h=4.2, mat_roof=cn.M['gold'])

# ═══ 运行 ═══
import importlib
importlib.reload(cn)
def mat_glass_grid(scale=1.6, base=(0.35, 0.48, 0.58), name="glass_grid"):
    m = cn._clear_mat(name)
    m.use_nodes = True
    nt = m.node_tree
    b = nt.nodes["Principled BSDF"]
    b.inputs["Roughness"].default_value = 0.12
    b.inputs["Metallic"].default_value = 0.55
    b.inputs["Base Color"].default_value = (*base, 1)
    tc = nt.nodes.new("ShaderNodeTexCoord")
    brick = nt.nodes.new("ShaderNodeTexBrick")
    brick.offset = 0.0
    brick.inputs["Scale"].default_value = scale
    brick.inputs["Mortar Size"].default_value = 0.03
    brick.inputs["Mortar"].default_value = (0.75, 0.77, 0.8, 1)
    brick.inputs["Color1"].default_value = (*base, 1)
    brick.inputs["Color2"].default_value = tuple(c * 0.8 for c in base) + (1,)
    nt.links.new(tc.outputs["UV"], brick.inputs["Vector"])
    nt.links.new(brick.outputs["Color"], b.inputs["Base Color"])
    return m
cn.mat_glass_grid = mat_glass_grid
cn.build_materials()

taihedian()
qiniandian()
tiananmen()
zhengyangmen()
jianlou()
yongdingmen()
wumen()
jiaolou()
shenwumen()
donghuamen()
xihuamen()
taihemen()
gulou()
zhonglou()
chinazun()
cctv()
birdnest()
watercube()
ncpa()
guomao3()
print("ALL LANDMARKS BUILT")
