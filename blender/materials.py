"""Cycles bake -> actual glTF base-color, roughness and tangent normal textures."""
import bpy
from pathlib import Path
import cnroof as cn
ROOT=Path(__file__).resolve().parents[1];TEXTURES=ROOT/'assets-source'/'textures';TEXTURES.mkdir(parents=True,exist_ok=True)
SPECS={
'gold':('glazed_gold',(.68,.38,.055),.27,.12,'tile'),'blue':('glazed_blue',(.025,.075,.24),.25,.08,'tile'),
'green':('glazed_green',(.04,.20,.09),.3,.06,'tile'),'red':('wall_red',(.40,.065,.045),.75,0,'plaster'),
'redwood':('wood_red',(.28,.045,.025),.55,0,'wood'),'marble':('carved_marble',(.82,.82,.78),.64,0,'stone'),
'caihua':('painted_beams',(.025,.09,.18),.55,0,'paint'),'gray':('grey_brick',(.30,.30,.28),.8,0,'brick'),
'dark':('grey_roof_tiles',(.095,.105,.105),.7,0,'tile'),'goldbright':('gold_finials',(.78,.50,.10),.24,.85,'metal'),
'glass':('glass_curtainwall',(.14,.23,.28),.22,.55,'glass'),'steel':('steel_structure',(.40,.42,.44),.38,.8,'metal'),
 'titan':('titanium_panels',(.48,.50,.52),.3,.82,'metal'),'white':('white_stucco',(.80,.79,.75),.8,0,'plaster'),
'cream':('stone_relief',(.64,.62,.56),.8,0,'stone'),'grass':('grass',(.09,.19,.035),.95,0,'plaster'),
'bubble':('etfe_cells',(.12,.29,.46),.24,.18,'bubble'),
'stadiumsteel':('stadium_painted_steel',(.60,.61,.60),.52,.12,'metal'),
'stadiumroof':('stadium_roof_etfe',(.67,.70,.71),.45,.05,'plaster'),
'stadiumacoustic':('stadium_acoustic_ptfe',(.80,.79,.74),.8,0,'plaster'),
'track':('athletics_track',(.55,.16,.10),.9,0,'plaster'),
'stadiumseat':('stadium_mid_seats',(.55,.22,.18),.75,0,'plaster'),
'towerwhite':('painted_white_steel',(.78,.80,.80),.48,.25,'metal')}
def material(spec):
    name,color,rough,metal,kind=spec;m=bpy.data.materials.new(name);m.use_nodes=True;nt=m.node_tree;b=nt.nodes.get('Principled BSDF');b.inputs['Metallic'].default_value=metal
    tc=nt.nodes.new('ShaderNodeTexCoord');noise=nt.nodes.new('ShaderNodeTexNoise');noise.inputs['Scale'].default_value=48;nt.links.new(tc.outputs['UV'],noise.inputs['Vector'])
    ramp=nt.nodes.new('ShaderNodeValToRGB');ramp.color_ramp.elements[0].color=tuple(c*.83 for c in color)+(1,);ramp.color_ramp.elements[1].color=tuple(min(1,c*1.12) for c in color)+(1,);nt.links.new(noise.outputs['Fac'],ramp.inputs['Fac']);nt.links.new(ramp.outputs['Color'],b.inputs['Base Color'])
    scale=nt.nodes.new('ShaderNodeMath');scale.operation='MULTIPLY_ADD';scale.inputs[1].default_value=.14;scale.inputs[2].default_value=rough-.07;nt.links.new(noise.outputs['Fac'],scale.inputs[0]);nt.links.new(scale.outputs[0],b.inputs['Roughness']);height=noise.outputs['Fac']
    if kind in ['tile','brick','glass','paint']:
        brick=nt.nodes.new('ShaderNodeTexBrick');brick.offset=0 if kind in ['tile','glass'] else .5;brick.inputs['Scale'].default_value=12 if kind=='tile' else 6;brick.inputs['Mortar Size'].default_value=.025;brick.inputs['Brick Width'].default_value=.5;brick.inputs['Row Height'].default_value=.14 if kind=='tile' else .3
        brick.inputs['Color1'].default_value=(*color,1);brick.inputs['Color2'].default_value=tuple(c*.87 for c in color)+(1,);brick.inputs['Mortar'].default_value=tuple(c*.35 for c in color)+(1,);nt.links.new(tc.outputs['UV'],brick.inputs['Vector']);nt.links.new(brick.outputs['Color'],b.inputs['Base Color']);height=brick.outputs['Fac']
    if kind=='bubble':
        # A 32m repeating panel field with ~6 irregular cells yields ~5.3m cells.
        # This is original visual inference, not a scan of the built Weaire-Phelan foam.
        vor=nt.nodes.new('ShaderNodeTexVoronoi');vor.feature='DISTANCE_TO_EDGE';vor.inputs['Scale'].default_value=6;nt.links.new(tc.outputs['UV'],vor.inputs['Vector'])
        edge=nt.nodes.new('ShaderNodeValToRGB');edge.color_ramp.elements[0].position=0;edge.color_ramp.elements[0].color=(.55,.72,.84,1);edge.color_ramp.elements[1].position=.045;edge.color_ramp.elements[1].color=(.16,.35,.53,1)
        for pos,col in [(.15,(.12,.29,.45,1)),(.35,(.24,.43,.60,1))]:edge.color_ramp.elements.new(pos).color=col
        nt.links.new(vor.outputs['Distance'],edge.inputs['Fac'])
        cell=nt.nodes.new('ShaderNodeTexVoronoi');cell.feature='F1';cell.inputs['Scale'].default_value=6;nt.links.new(tc.outputs['UV'],cell.inputs['Vector'])
        tint=nt.nodes.new('ShaderNodeValToRGB');tint.color_ramp.elements[0].color=(.75,.85,.95,1);tint.color_ramp.elements[1].color=(1,1,1,1);nt.links.new(cell.outputs['Color'],tint.inputs['Fac'])
        multiply=nt.nodes.new('ShaderNodeMixRGB');multiply.blend_type='MULTIPLY';multiply.inputs[0].default_value=.45;nt.links.new(edge.outputs['Color'],multiply.inputs[1]);nt.links.new(tint.outputs['Color'],multiply.inputs[2]);nt.links.new(multiply.outputs['Color'],b.inputs['Base Color'])
        pillow=nt.nodes.new('ShaderNodeMapRange');pillow.interpolation_type='SMOOTHSTEP';pillow.inputs['From Min'].default_value=0;pillow.inputs['From Max'].default_value=.33;nt.links.new(vor.outputs['Distance'],pillow.inputs['Value']);height=pillow.outputs['Result']
        roughmap=nt.nodes.new('ShaderNodeMapRange');roughmap.inputs['From Max'].default_value=.25;roughmap.inputs['To Min'].default_value=.5;roughmap.inputs['To Max'].default_value=.22;nt.links.new(vor.outputs['Distance'],roughmap.inputs['Value']);nt.links.new(roughmap.outputs['Result'],b.inputs['Roughness'])
    bump=nt.nodes.new('ShaderNodeBump');bump.inputs['Strength'].default_value=.8 if kind=='bubble' else .24;bump.inputs['Distance'].default_value=.18 if kind=='bubble' else .035;nt.links.new(height,bump.inputs['Height']);nt.links.new(bump.outputs['Normal'],b.inputs['Normal']);return m
def bake_materials(resolution=512,force=False,force_keys=()):
    scene=bpy.context.scene;scene.render.engine='CYCLES';scene.cycles.samples=1;scene.cycles.device='CPU';scene.render.bake.use_pass_direct=False;scene.render.bake.use_pass_indirect=False;scene.render.bake.use_pass_color=True
    bpy.ops.mesh.primitive_plane_add(size=4);plane=bpy.context.object;plane.name='material baking plane'
    for key,spec in SPECS.items():
        m=material(spec);plane.data.materials.clear();plane.data.materials.append(m);nt=m.node_tree;b=nt.nodes.get('Principled BSDF');images={}
        for suffix,bake_type in [('basecolor','DIFFUSE'),('normal','NORMAL'),('roughness','ROUGHNESS')]:
            path=TEXTURES/f'{spec[0]}-{suffix}.png'
            if path.exists() and not force and key not in force_keys:image=bpy.data.images.load(str(path),check_existing=True)
            else:
                image=bpy.data.images.new(f'{spec[0]}-{suffix}',width=resolution,height=resolution,alpha=False);image.colorspace_settings.name='sRGB' if suffix=='basecolor' else 'Non-Color';target=nt.nodes.new('ShaderNodeTexImage');target.image=image;nt.nodes.active=target
                bpy.ops.object.bake(type=bake_type,margin=4,use_clear=True);image.filepath_raw=str(path);image.file_format='PNG';image.save();nt.nodes.remove(target)
            image.colorspace_settings.name='sRGB' if suffix=='basecolor' else 'Non-Color';image.pack();images[suffix]=image
        for node in list(nt.nodes):
            if node.type not in ['BSDF_PRINCIPLED','OUTPUT_MATERIAL']:nt.nodes.remove(node)
        for suffix,socket in [('basecolor','Base Color'),('roughness','Roughness')]:
            tex=nt.nodes.new('ShaderNodeTexImage');tex.image=images[suffix];tex.extension='REPEAT';nt.links.new(tex.outputs['Color'],b.inputs[socket])
        normal=nt.nodes.new('ShaderNodeTexImage');normal.image=images['normal'];normal.extension='REPEAT';normalmap=nt.nodes.new('ShaderNodeNormalMap');nt.links.new(normal.outputs['Color'],normalmap.inputs['Color']);nt.links.new(normalmap.outputs['Normal'],b.inputs['Normal']);m.diffuse_color=(*spec[1],1);cn.M[key]=m;print('PBR baked:',spec[0],flush=True)
    bpy.data.objects.remove(plane,do_unlink=True);return cn.M
