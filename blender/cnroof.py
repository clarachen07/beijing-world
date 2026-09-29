"""
北京世界 — 中国古建筑 Blender 生成器库（无头运行, Blender 原生 Z-up）
坐标系: +X 东, +Y 北, +Z 上（导出 glTF 时自动转 Y-up, three.js 中 x东/y上/z南）
用法: blender -b -P xxx.py   (脚本里 import cnroof)
"""
import bpy
import math

# ── 材质库 ────────────────────────────────────────────────
def _clear_mat(name):
    m = bpy.data.materials.get(name)
    if m: bpy.data.materials.remove(m)
    return bpy.data.materials.new(name)

def mat_glazed(name, base, rib=14.0, rough=0.3):
    """琉璃瓦: 纯色基色 + 瓦垄条纹 bump"""
    m = _clear_mat(name)
    m.use_nodes = True
    nt = m.node_tree
    bsdf = nt.nodes["Principled BSDF"]
    bsdf.inputs["Roughness"].default_value = rough
    bsdf.inputs["Metallic"].default_value = 0.1
    bsdf.inputs["Base Color"].default_value = (*base, 1)
    tc = nt.nodes.new("ShaderNodeTexCoord")
    brick = nt.nodes.new("ShaderNodeTexBrick")
    brick.offset = 0.5
    brick.inputs["Scale"].default_value = rib
    brick.inputs["Mortar Size"].default_value = 0.02
    brick.inputs["Mortar"].default_value = (0, 0, 0, 1)
    bump = nt.nodes.new("ShaderNodeBump")
    bump.inputs["Strength"].default_value = 0.5
    nt.links.new(tc.outputs["UV"], brick.inputs["Vector"])
    nt.links.new(brick.outputs["Fac"], bump.inputs["Height"])
    nt.links.new(bump.outputs["Normal"], bsdf.inputs["Normal"])
    return m

def mat_simple(name, base, rough=0.6, metal=0.0):
    m = _clear_mat(name)
    m.use_nodes = True
    b = m.node_tree.nodes["Principled BSDF"]
    b.inputs["Base Color"].default_value = (*base, 1)
    b.inputs["Roughness"].default_value = rough
    b.inputs["Metallic"].default_value = metal
    return m

def mat_marble(name="marble"):
    m = _clear_mat(name)
    m.use_nodes = True
    nt = m.node_tree
    b = nt.nodes["Principled BSDF"]
    b.inputs["Base Color"].default_value = (0.90, 0.89, 0.86, 1)
    b.inputs["Roughness"].default_value = 0.55
    noise = nt.nodes.new("ShaderNodeTexNoise")
    noise.inputs["Scale"].default_value = 2.2
    ramp = nt.nodes.new("ShaderNodeValToRGB")
    ramp.color_ramp.elements[0].position = 0.4
    ramp.color_ramp.elements[0].color = (0.85, 0.84, 0.81, 1)
    ramp.color_ramp.elements[1].position = 0.65
    ramp.color_ramp.elements[1].color = (0.97, 0.96, 0.94, 1)
    nt.links.new(noise.outputs["Fac"], ramp.inputs["Fac"])
    nt.links.new(ramp.outputs["Color"], b.inputs["Base Color"])
    return m

def mat_caihua(name="caihua"):
    """檐下彩画带: 纯色深蓝青（glTF 导出仅保留基色, 程序纹理链会被丢弃）"""
    return mat_simple(name, (0.06, 0.16, 0.38), rough=0.42)

M = {}
def build_materials():
    M['gold'] = mat_glazed("glazed_gold", (0.74, 0.47, 0.08))
    M['blue'] = mat_glazed("glazed_blue", (0.05, 0.13, 0.36), rib=22.0)
    M['green'] = mat_glazed("glazed_green", (0.08, 0.27, 0.16))
    M['red'] = mat_simple("wall_red", (0.36, 0.075, 0.055), rough=0.62)
    M['redwood'] = mat_simple("wood_red", (0.30, 0.06, 0.045), rough=0.48)
    M['marble'] = mat_marble()
    M['caihua'] = mat_caihua()
    M['gray'] = mat_simple("stone_gray", (0.56, 0.54, 0.51), rough=0.72)
    M['dark'] = mat_simple("ridge_dark", (0.15, 0.11, 0.08), rough=0.4, metal=0.3)
    M['goldbright'] = mat_simple("gold_bright", (0.86, 0.67, 0.20), rough=0.2, metal=0.85)
    M['glass'] = mat_simple("glass_cool", (0.45, 0.58, 0.66), rough=0.12, metal=0.6)
    M['steel'] = mat_simple("steel", (0.62, 0.65, 0.68), rough=0.35, metal=0.9)
    M['titan'] = mat_simple("titanium", (0.72, 0.73, 0.75), rough=0.3, metal=0.8)
    M['white'] = mat_simple("white_plaster", (0.88, 0.87, 0.84), rough=0.6)
    M['cream'] = mat_simple("cream", (0.83, 0.81, 0.75), rough=0.65)
    return M

# ── 网格工具 ──────────────────────────────────────────────
def new_mesh_obj(name, verts, faces, mat=None):
    me = bpy.data.meshes.new(name)
    me.from_pydata(verts, [], faces)
    me.validate()
    me.update()
    ob = bpy.data.objects.new(name, me)
    bpy.context.collection.objects.link(ob)
    if mat: me.materials.append(mat)
    uv = me.uv_layers.new(name="UVMap")
    if uv:
        for poly in me.polygons:
            n = poly.normal
            for li in poly.loop_indices:
                v = me.vertices[me.loops[li].vertex_index].co
                if abs(n.z) > 0.7: uv.data[li].uv = (v.x * 0.09, v.y * 0.09)
                elif abs(n.y) > 0.7: uv.data[li].uv = (v.x * 0.09, v.z * 0.09)
                else: uv.data[li].uv = (v.y * 0.09, v.z * 0.09)
    return ob

def solidify(ob, thickness=0.25):
    mod = ob.modifiers.new("solid", 'SOLIDIFY')
    mod.thickness = thickness
    return ob

def shade_smooth_angle(ob, angle=45):
    for p in ob.data.polygons:
        p.use_smooth = True
    mod = ob.modifiers.new("esplit", 'EDGE_SPLIT')
    mod.split_angle = math.radians(angle)
    return ob

def join_objs(objs, name="joined"):
    """合并对象并应用修改器"""
    for o in objs: o.select_set(True)
    bpy.context.view_layer.objects.active = objs[0]
    bpy.ops.object.join()
    ob = bpy.context.active_object
    ob.name = name
    bpy.ops.object.convert(target='MESH')
    return ob

# ── 基本体 ────────────────────────────────────────────────
def box(name, sx, sy, sz, x=0, y=0, z=0, mat=None):
    """显式三轴尺寸: sx=X(东西) sy=Y(南北) sz=Z(高); z=底部高度"""
    bpy.ops.mesh.primitive_cube_add(size=1, location=(x, y, z + sz / 2))
    ob = bpy.context.active_object
    ob.scale = (sx, sy, sz)
    bpy.ops.object.transform_apply(scale=True)
    ob.name = name
    if mat: ob.data.materials.append(mat)
    return ob

def cyl(name, r, h, x=0, y=0, z=0, seg=24, mat=None):
    bpy.ops.mesh.primitive_cylinder_add(vertices=seg, radius=r, depth=h, location=(x, y, z + h / 2))
    ob = bpy.context.active_object
    ob.name = name
    if mat: ob.data.materials.append(mat)
    return ob

def tube(name, r, h, x=0, y=0, z=0, seg=24, mat=None):
    bpy.ops.mesh.primitive_cylinder_add(vertices=seg, radius=r, depth=h, location=(x, y, z + h / 2))
    ob = bpy.context.active_object
    bpy.ops.object.mode_set(mode='EDIT')
    bpy.ops.mesh.select_all(action='SELECT')
    bpy.ops.mesh.delete(type='ONLY_FACE')
    bpy.ops.object.mode_set(mode='OBJECT')
    bpy.ops.object.modifier_add(type='SOLIDIFY')
    ob.modifiers["Solidify"].thickness = 0.06
    ob.name = name
    if mat: ob.data.materials.append(mat)
    return ob

# ── 曲面庑殿顶 ────────────────────────────────────────────
def hip_roof(w, d, h, top_w=None, top_d=None, seg_u=72, seg_v=16, flare=1.2, mat=None, name="roof"):
    """曲面庑殿顶（支持截顶=重檐下檐）: 俯视外沿 w(X)×d(Y), 高 h, 顶面 top_w×top_d
    举折: 檐缓脊陡 → z(v)=h*v^1.45 (v: 檐0→脊1), 檐角起翘 flare"""
    if top_w is None: top_w = w * 0.42
    if top_d is None: top_d = 0.0
    verts, faces = [], []
    for iv in range(seg_v + 1):
        v = iv / seg_v
        z = h * (v ** 1.45)
        L = w + (top_w - w) * v
        D = d + (top_d - d) * v
        for iu in range(seg_u + 1):
            u = iu / seg_u
            x = (u - 0.5) * L
            y = (u - 0.5) * D
            cw = (abs(2 * u - 1)) ** 3.0 * (1 - v) ** 1.3
            zz = z + flare * cw * (0.22 + 0.25 * (1 - v) ** 2)
            verts.append((x, y, zz))
    for iv in range(seg_v):
        for iu in range(seg_u):
            a = iv * (seg_u + 1) + iu
            b = a + 1
            c = a + seg_u + 1
            dd = c + 1
            faces.append((a, c, dd, b))
    ob = new_mesh_obj(name, verts, faces, mat)
    solidify(ob, max(0.14, h * 0.04))
    shade_smooth_angle(ob, 50)
    return ob

def conic_roof(r_bottom, r_top, h, seg=56, eave_lift=0.25, mat=None, name="conic"):
    """圆形攒尖顶层: 凹曲轮廓 + 檐口上翘"""
    seg_v = 12
    verts, faces = [], []
    for iv in range(seg_v + 1):
        v = iv / seg_v
        r = r_bottom + (r_top - r_bottom) * v
        z = h * (1 - (1 - v) ** 1.5)
        lift = eave_lift * (1 - v) ** 3
        for iu in range(seg):
            a = 2 * math.pi * iu / seg
            verts.append((math.cos(a) * r, math.sin(a) * r, z + lift))
    for iv in range(seg_v):
        for iu in range(seg):
            a = iv * seg + iu
            b = iv * seg + (iu + 1) % seg
            c = (iv + 1) * seg + (iu + 1) % seg
            dd = (iv + 1) * seg + iu
            faces.append((a, b, c, dd))
    ci = len(verts)
    verts.append((0, 0, h))
    for iu in range(seg):
        a = seg_v * seg + iu
        b = seg_v * seg + (iu + 1) % seg
        faces.append((ci, b, a))
    ob = new_mesh_obj(name, verts, faces, mat)
    solidify(ob, 0.15)
    shade_smooth_angle(ob, 60)
    return ob

# ── 台基 ──────────────────────────────────────────────────
def terrace(w, d, tiers=3, tier_h=2.7, inset=1.8, mat=None, pillar_gap=3.2, name="terrace"):
    """方形台基, 返回 (objs, top_z)"""
    objs = []
    z = 0
    for t in range(tiers):
        ww = w - 2 * inset * t
        dd = d - 2 * inset * t
        objs.append(box(f"terr{t}", ww, dd, tier_h, 0, 0, z, mat))
        n_x = max(2, int(ww / pillar_gap))
        n_y = max(2, int(dd / pillar_gap))
        zz = z + tier_h
        for i in range(n_x):
            px = -ww / 2 + 0.3 + i * (ww - 0.6) / (n_x - 1)
            for py in (-dd / 2 + 0.15, dd / 2 - 0.15):
                objs.append(box("wp", 0.26, 0.26, 1.05, px, py, zz - 0.3, mat))
        for i in range(n_y):
            py = -dd / 2 + 0.3 + i * (dd - 0.6) / (n_y - 1)
            for px in (-ww / 2 + 0.15, ww / 2 - 0.15):
                objs.append(box("wp", 0.26, 0.26, 1.05, px, py, zz - 0.3, mat))
        z += tier_h
    return objs, z

def circular_terrace(r, tiers=3, tier_h=2.4, inset=3.0, mat=None, seg=72, pillar_gap=3.4, name="cterrace"):
    objs = []
    z = 0
    for t in range(tiers):
        rr = r - inset * t
        objs.append(cyl(f"cterr{t}", rr, tier_h, 0, 0, z, seg, mat))
        n = max(10, int(2 * math.pi * rr / pillar_gap))
        for i in range(n):
            a = 2 * math.pi * i / n
            objs.append(box("cp", 0.3, 0.3, 1.05, math.cos(a) * (rr - 0.35), math.sin(a) * (rr - 0.35), z + tier_h - 0.3, mat))
        z += tier_h
    return objs, z

# ── 柱廊 + 额枋彩画 + 斗拱 ────────────────────────────────
def hall_body(w, d, n_bays_x=11, n_bays_z=5, col_h=8.5, col_r=0.45, mat_wall=None, mat_paint=None, name="hall"):
    """殿身: 周边柱+墙+额枋+彩画带+斗拱块, 返回 (objs, top_z)"""
    objs = []
    xs = [(-w / 2 + i * w / (n_bays_x - 1)) for i in range(n_bays_x)]
    zs = [(-d / 2 + i * d / (n_bays_z - 1)) for i in range(n_bays_z)]
    for x in xs:
        for y in (d / 2 - 0.35, -d / 2 + 0.35):
            objs.append(cyl("col", col_r, col_h, x, y, 0, 12, mat_wall))
    for y in zs[1:-1]:
        for x in (-w / 2 + 0.35, w / 2 - 0.35):
            objs.append(cyl("col", col_r, col_h, x, y, 0, 12, mat_wall))
    # 墙（退在柱内侧）
    objs.append(box("wall_s", w - 1.2, 0.35, col_h * 0.85, 0, d / 2 - 0.85, 0, mat_wall))
    objs.append(box("wall_n", w - 1.2, 0.35, col_h * 0.85, 0, -d / 2 + 0.85, 0, mat_wall))
    objs.append(box("wall_e", 0.35, d - 1.2, col_h * 0.85, w / 2 - 0.85, 0, 0, mat_wall))
    objs.append(box("wall_w", 0.35, d - 1.2, col_h * 0.85, -w / 2 + 0.85, 0, 0, mat_wall))
    top = col_h
    # 大额枋 + 彩画带 + 斗拱
    objs.append(box("efang", w, d, 1.1, 0, 0, top, mat_wall))
    objs.append(box("caihua", w + 0.25, d + 0.25, 0.8, 0, 0, top + 1.1, mat_paint))
    n = int(2 * (w + d) / 1.35)
    per = 2 * (w + d)
    for i in range(n):
        s = i / n * per
        if s < w: x = -w / 2 + s; y = d / 2 + 0.5
        elif s < w + d: x = w / 2 + 0.5; y = d / 2 - (s - w)
        elif s < 2 * w + d: x = w / 2 - (s - w - d); y = -d / 2 - 0.5
        else: x = -w / 2 - 0.5; y = -d / 2 + (s - 2 * w - d)
        objs.append(box("dg", 0.6, 0.6, 0.6, x, y, top + 1.9, mat_wall))
    return objs, top + 2.5

def ridge_ornaments(w_ridge, z, mat, name="ridge"):
    """正脊 + 鸱吻"""
    objs = [box("zj", w_ridge, 0.8, 0.7, 0, 0, z, mat)]
    for sx in (-1, 1):
        objs.append(box("cw", 1.2, 0.95, 1.7, sx * (w_ridge / 2 - 0.35), 0, z + 0.5, mat))
    return objs

def export_glb(path):
    bpy.ops.object.select_all(action='DESELECT')
    for o in bpy.data.objects: o.select_set(True)
    bpy.context.view_layer.objects.active = list(bpy.data.objects)[0]
    bpy.ops.export_scene.gltf(filepath=path, export_format='GLB', export_yup=True)
    print("EXPORTED:", path)
