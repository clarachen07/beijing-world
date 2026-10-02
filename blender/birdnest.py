"""Source-informed stadium massing; member routes and seating rows remain approximations.
Local X is the long north/south axis after the registered 86.29-degree placement.
"""
import math,random
from mathutils import Vector
import cnroof as c
TAU=math.tau

def beams(name,segments,width,depth,mat):
    verts=[];faces=[]
    for a,b in segments:
        a,b=Vector(a),Vector(b);direction=b-a
        if direction.length<.01:continue
        direction.normalize();side=Vector((0,0,1)).cross(direction)
        if side.length<.01:side=Vector((1,0,0))
        side.normalize();up=direction.cross(side).normalized();start=len(verts)
        for center in [a,b]:
            for ss,tt in [(-1,-1),(1,-1),(1,1),(-1,1)]:verts.append(tuple(center+ss*width*.5*side+tt*depth*.5*up))
        faces.extend(tuple(start+i for i in f) for f in [(3,2,1,0),(4,5,6,7),(0,1,5,4),(1,2,6,5),(2,3,7,6),(3,0,4,7)])
    return c.new_mesh_obj(name,verts,faces,mat)

def paint_lines(name,segments,width,mat):
    verts=[];faces=[]
    for aa,bb in segments:
        a,b=Vector(aa),Vector(bb);d=b-a;side=Vector((-d.y,d.x,0))
        if side.length<.01:continue
        side.normalize();side*=width/2;start=len(verts)
        verts.extend(tuple(v) for v in [a-side,b-side,b+side,a+side]);faces.append((start,start+1,start+2,start+3))
    return c.new_mesh_obj(name,verts,faces,mat)

def build():
    objs=[];rng=random.Random(2262008);seg=128
    # Clear hole is 185.3 x 127.5m. The rim chord centre lies .6m outside it.
    outer=(165.6,146.1);inner=(93.25,64.35)
    def roof(a,t,drop=0):
        x=(outer[0]*(1-t)+inner[0]*t)*math.cos(a);y=(outer[1]*(1-t)+inner[1]*t)*math.sin(a)
        z=(60+8*math.sin(a)**2)*(1-t)+(54+9*math.sin(a)**2)*t
        return (x,y,z-drop)
    def wall(a,t,inset=0):
        rr=.94+.06*math.sin(math.pi*t*.5)
        return ((outer[0]*rr-inset)*math.cos(a),(outer[1]*rr-inset)*math.sin(a),t*(60+8*math.sin(a)**2))
    def pairs(points):return list(zip(points,points[1:]))
    # Continuous annuli, never a fan closing the central event-space opening.
    for name,drop,mat in [('ETFE upper roof membrane',.9,c.M['stadiumroof']),('PTFE acoustic lower roof membrane',13.9,c.M['stadiumacoustic'])]:
        verts=[];faces=[];radial=8
        for j in range(radial+1):verts.extend(roof(i*TAU/seg,j/radial,drop) for i in range(seg))
        for j in range(radial):
            for i in range(seg):
                k=j*seg+i;n=j*seg+(i+1)%seg;faces.append((k,n,n+seg,k+seg))
        o=c.new_mesh_obj(name,verts,faces,mat)
        for p in o.data.polygons:p.use_smooth=True
        objs.append(o)
    primary=[]
    for k in range(24):
        a=k*TAU/24
        # Paired chords and diagonal webs give each main support actual truss depth.
        for inset in [0,10.8]:primary+=pairs([wall(a,j/8,inset) for j in range(9)])
        for j in range(8):
            primary.append((wall(a,j/8,0),wall(a,(j+1)/8,10.8)))
            primary.append((wall(a,j/8,10.8),wall(a,(j+1)/8,0)))
        for drop in [0,12]:primary+=pairs([roof(a,j/6,drop) for j in range(7)])
        for j in range(6):primary.append((roof(a,j/6,0),roof(a,(j+1)/6,12)))
    objs.append(beams('24 primary facade and roof trusses',primary,1.2,1.2,c.M['stadiumsteel']))
    # Fixed irregular routing expresses the observed woven lattice without claiming
    # to reproduce individual fabricated members from an unavailable fabrication model.
    lattice=[]
    for k in range(152):
        a=k*TAU/152+rng.uniform(-.055,.055);turn=rng.choice([-1,1])*rng.uniform(.45,1.35);phase=rng.uniform(0,TAU)
        pts=[wall(a+turn*t+.11*math.sin(3*math.pi*t+phase)*math.sin(math.pi*t),t) for t in [j/8 for j in range(9)]]
        lattice+=pairs(pts)
    objs.append(beams('woven lattice facade secondary steel',lattice,1.2,.75,c.M['stadiumsteel']))
    lattice=[]
    for k in range(216):
        a=k*TAU/216+rng.uniform(-.045,.045);turn=rng.choice([-1,1])*rng.uniform(.18,1.0);phase=rng.uniform(0,TAU)
        pts=[roof(a+turn*t+.055*math.sin(4*math.pi*t+phase)*math.sin(math.pi*t),t,-.08) for t in [j/6 for j in range(7)]]
        lattice+=pairs(pts)
    objs.append(beams('woven lattice roof secondary steel',lattice,1.2,.8,c.M['stadiumsteel']))
    # Circumferential members remain below the crossing members and roof membrane.
    rim=[]
    for t in [0,1]:rim+=pairs([roof(i*TAU/seg,t) for i in range(seg+1)])
    objs.append(beams('primary outer and opening rim chords',rim,1.2,1.2,c.M['stadiumsteel']))
    purlins=[]
    for j in range(1,8):purlins+=pairs([roof(i*TAU/seg,j/8,.48) for i in range(seg+1)])
    objs.append(beams('woven lattice roof purlins',purlins,.32,.35,c.M['stadiumsteel']))
    # Three actual stepped tiers. Bowl height changes from N/S45m to E/W51m.
    seating_specs=[('lower',(101.5,67.5),(114.5,80.5),3.5,15.5,26),('middle',(117,83),(125,91),18.5,31.5,20),('upper',(128,94),(147,113),33,45,30)]
    for name,r0,r1,z0,z1,rows in seating_specs:
        treads={key:([],[]) for key in ['red','stadiumseat','white']};risers=[];rise_faces=[]
        for row in range(rows):
            t0=row/rows;t1=(row+1)/rows;matkey='red' if name=='lower' else 'stadiumseat' if name=='middle' else 'stadiumseat' if row<12 else 'white';verts,faces=treads[matkey]
            ring=[]
            for t in [t0,t1]:
                for i in range(seg):
                    a=i*TAU/seg;rx=r0[0]*(1-t)+r1[0]*t;ry=r0[1]*(1-t)+r1[1]*t
                    high=z1+(6*math.sin(a)**2 if name=='upper' else 0);z=z0+(high-z0)*t1
                    ring.append((rx*math.cos(a),ry*math.sin(a),z))
            start=len(verts);verts.extend(ring)
            for i in range(seg):faces.append((start+i,start+(i+1)%seg,start+seg+(i+1)%seg,start+seg+i))
            start=len(risers)
            for t in [t0,t1]:
                for i in range(seg):
                    a=i*TAU/seg;rx=r0[0]*(1-t0)+r1[0]*t0;ry=r0[1]*(1-t0)+r1[1]*t0;high=z1+(6*math.sin(a)**2 if name=='upper' else 0)
                    risers.append((rx*math.cos(a),ry*math.sin(a),z0+(high-z0)*t))
            for i in range(seg):rise_faces.append((start+i,start+(i+1)%seg,start+seg+(i+1)%seg,start+seg+i))
        for key,(v,f) in treads.items():
            if f:objs.append(c.new_mesh_obj(name+' tier narrow seat rows '+key,v,f,c.M[key]))
        objs.append(c.new_mesh_obj(name+' tier concrete step risers',risers,rise_faces,c.M['gray']))
    # Elliptical concourse decks are set behind the open outer lattice.
    for z,rx,ry in [(16.5,118,84),(32,127,93),(44,149,115)]:
        verts=[];faces=[]
        for r in [0,5]:verts.extend(((rx+r)*math.cos(i*TAU/seg),(ry+r)*math.sin(i*TAU/seg),z) for i in range(seg))
        for i in range(seg):faces.append((i,(i+1)%seg,seg+(i+1)%seg,seg+i))
        objs.append(c.new_mesh_obj('concourse deck',verts,faces,c.M['gray']))
    # Official 195x126m is the athletics apron, not the oval racing-line dimensions.
    objs.append(c.cyl('athletics apron',1,.18,z=0,seg=128,mat=c.M['gray']))
    # Bake metre geometry before UV assignment; scaling a unit disc after UVs
    # would turn the tiny paving pattern into enormous visible floor squares.
    for v in objs[-1].data.vertices:v.co.x*=97.5;v.co.y*=63
    objs[-1].data.update();c.planar_uv(objs[-1])
    half_straight=84.39/2
    def track_point(i,n,r,z):
        a=i*TAU/n;return ((half_straight if math.cos(a)>=0 else -half_straight)+r*math.cos(a),r*math.sin(a),z)
    n=192;verts=[];faces=[]
    for r in [36.5,36.5+9*1.22]:verts.extend(track_point(i,n,r,.22) for i in range(n))
    for i in range(n):faces.append((i,(i+1)%n,n+(i+1)%n,n+i))
    objs.append(c.new_mesh_obj('nine lane 400m athletics oval',verts,faces,c.M['track']))
    # Add the two straight tangents explicitly; they connect the semicircle vertices.
    lines=[]
    for lane in range(10):
        r=36.5+lane*1.22;lines+=pairs([track_point(i,n,r,.235) for i in range(n+1)])
    lines.append(((-half_straight,-47.48,.235),(-half_straight,47.48,.235)))
    objs.append(paint_lines('track lane painted markings',lines,.055,c.M['white']))
    objs.append(c.box('official 110 by 72m football grass area',110,72,.17,z=.24,mat=c.M['grass']))
    # Standard 105x68m competition markings are a documented inference, distinct
    # from the 110x72m official turf envelope and not a claimed as-built survey.
    markings=[]
    for y in [-34,34]:markings.append(((-52.5,y,.425),(52.5,y,.425)))
    for x in [-52.5,0,52.5]:markings.append(((x,-34,.425),(x,34,.425)))
    markings+=pairs([(9.15*math.cos(i*TAU/64),9.15*math.sin(i*TAU/64),.425) for i in range(65)])
    for side in [-1,1]:
        x=side*52.5;edge=side*(52.5-16.5)
        markings.extend([((x,-20.16,.425),(edge,-20.16,.425)),((edge,-20.16,.425),(edge,20.16,.425)),((edge,20.16,.425),(x,20.16,.425))])
        for y in [-3.66,3.66]:markings.append(((x,y,.425),(x,y,2.865)))
        markings.append(((x,-3.66,2.865),(x,3.66,2.865)))
    objs.append(beams('football markings and goal frames',markings,.08,.04,c.M['white']))
    return objs
