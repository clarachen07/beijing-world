"""太和殿 — 按真实比例建模 (面阔60m×进深33m, 台基高7.8m, 通高约35m)
运行: blender -b -P taihedian.py
"""
import bpy, sys, os, math
sys.path.append(os.path.dirname(os.path.abspath(__file__)))
import cnroof as cn

# 清场
bpy.ops.object.select_all(action='DESELECT')
for o in list(bpy.data.objects):
    bpy.data.objects.remove(o, do_unlink=True)
cn.build_materials()

W, D = 60.0, 33.0          # 殿身面阔/进深
objs = []

# 1) 三层汉白玉台基 (底层 78×50)
terr, tz = cn.terrace(78, 50, tiers=3, tier_h=2.6, inset=1.7, mat=cn.M['marble'])
objs += terr

# 2) 殿身: 柱廊+红墙+额枋彩画+斗拱 (放在台基顶)
body, bz = cn.hall_body(W, D, n_bays_x=11, n_bays_z=5, col_h=9.0, col_r=0.5,
                        mat_wall=cn.M['red'], mat_paint=cn.M['caihua'])
for o in body:
    o.location.z += tz
objs += body

# 3) 下檐 (截顶庑殿: 从殿身顶环收到上檐平坐)
lower = cn.hip_roof(66, 39, 4.2, top_w=48, top_d=24, flare=0.9,
                    mat=cn.M['gold'], name="lower_eave")
lower.location.z = tz + bz
objs.append(lower)

# 4) 上檐主体 + 上层殿身短墙
upper_walls = cn.box("upper_walls", 45, 22, 4.5, 0, 0, tz + bz + 4.0, cn.M['red'])
objs.append(upper_walls)
z3 = tz + bz + 4.2
upper_body, uz = cn.hall_body(46, 24, n_bays_x=9, n_bays_z=4, col_h=4.4, col_r=0.42,
                              mat_wall=cn.M['red'], mat_paint=cn.M['caihua'])
for o in upper_body:
    o.location.z += z3
objs += upper_body
# 上檐屋顶
upper = cn.hip_roof(48, 25, 13.0, top_w=26.5, top_d=0.0, flare=1.5,
                    mat=cn.M['gold'], name="upper_roof")
upper.location.z = z3 + uz
objs.append(upper)

# 5) 正脊 + 鸱吻
ridge_z = z3 + uz + 13.0
objs += cn.ridge_ornaments(27, ridge_z - 0.2, cn.M['dark'])

# 6) 台基上的配殿小品 (东西两侧小亭)
for sx in (-1, 1):
    pav = []
    pav.append(cn.box("pav_body", 12, 10, 5, sx * 36, 0, tz, cn.M['red']))
    r = cn.hip_roof(14, 12, 4.0, top_w=5, top_d=0, flare=1.2, mat=cn.M['gold'], name="pav_roof")
    r.location = (sx * 36, 0, tz + 5)
    pav.append(r)
    objs += pav

# 合并导出
main = cn.join_objs(objs, "taihedian")
cn.export_glb(os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "public", "models", "legacy", "taihedian.glb"))

# 快速预览渲染 (EEVEE)
scene = bpy.context.scene
scene.render.engine = 'BLENDER_EEVEE_NEXT' if hasattr(bpy.types, 'SceneEEVEE') and 'NEXT' in str(dir(scene.render)) else 'BLENDER_EEVEE'
scene.render.resolution_x = 1280
scene.render.resolution_y = 960
scene.render.filepath = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "refs", "taihedian_render.jpg")
scene.render.image_settings.file_format = 'JPEG'
scene.render.image_settings.quality = 88
# 阳光
sun = bpy.data.lights.new("sun", 'SUN')
sun.energy = 4.0
sun.color = (1.0, 0.95, 0.85)
so = bpy.data.objects.new("sun", sun)
so.rotation_euler = (math.radians(55), 0, math.radians(-35))
bpy.context.collection.objects.link(so)
w = bpy.data.worlds.new("w")
w.use_nodes = True
w.node_tree.nodes["Background"].inputs[0].default_value = (0.55, 0.68, 0.85, 1)
w.node_tree.nodes["Background"].inputs[1].default_value = 1.2
scene.world = w
# 相机 (南偏西仰视, 用 TRACK_TO 保证对准)
cam = bpy.data.cameras.new("cam")
cam.lens = 40
co = bpy.data.objects.new("cam", cam)
co.location = (35, -118, 34)
bpy.context.collection.objects.link(co)
target = bpy.data.objects.new("cam_target", None)
target.location = (0, 0, 14)
bpy.context.collection.objects.link(target)
con = co.constraints.new('TRACK_TO')
con.target = target
scene.camera = co
bpy.ops.render.render(write_still=True)
print("RENDER DONE")
