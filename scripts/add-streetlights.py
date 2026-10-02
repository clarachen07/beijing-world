"""Add mapped OSM lamp points to LOD0/1 without rebaking the city geometry.

Positions are source observations; unspecified lamp heights are explicit estimates.
"""
from pathlib import Path
from collections import Counter
import hashlib, json, math, runpy
import osmium
from shapely.geometry import Point, shape, box
from shapely.affinity import affine_transform

ROOT=Path(__file__).resolve().parents[1]; OUT=ROOT/'public/data'; RAW=ROOT/'raw/geospatial'

def main():
    manifest=json.loads((OUT/'manifest.json').read_text())
    cfg=json.loads((ROOT/'config/world.json').read_text())
    boundary=shape(json.loads((OUT/manifest['coverage']['boundaryFile']).read_text())['geometry'])
    mx=111320*math.cos(math.radians(cfg['origin']['lat'])); mz=cfg['projection']['metresPerDegreeLat'];origin=cfg['origin']
    forward=[mx,0,0,-mz,-origin['lon']*mx,origin['lat']*mz];inverse=[1/mx,0,0,-1/mz,origin['lon'],origin['lat']]
    scope=affine_transform(affine_transform(boundary,forward).buffer(cfg.get('scopeBufferM',0)).union(affine_transform(box(*cfg['extensionBounds']),forward)),inverse)
    records=[]
    class Lamps(osmium.SimpleHandler):
        def node(self,node):
            if node.tags.get('highway')!='street_lamp' and node.tags.get('man_made')!='street_lamp': return
            if not scope.covers(Point(node.location.lon,node.location.lat)): return
            records.append({'id':f'node/{node.id}','lat':node.location.lat,'lon':node.location.lon,'tags':dict(node.tags)})
    handler=Lamps(); handler.apply_file(str(RAW/'Beijing.osm.pbf'))
    records.sort(key=lambda row:row['id'])
    helpers=runpy.run_path(str(ROOT/'scripts/bake-geospatial.py'))
    terrain=helpers['Terrain'](); confidence=Counter(); by_lod={0:{},1:{}}; provenance=[]
    for record in records:
        x=(record['lon']-cfg['origin']['lon'])*helpers['MLON']; z=(cfg['origin']['lat']-record['lat'])*helpers['MLAT']
        supplied=helpers['number'](record['tags'].get('height'))
        valid=supplied is not None and 1<=supplied<=40
        height=supplied if valid else 8.0; confidence['provided_height' if valid else 'lamp_height_estimate']+=1
        y=terrain.height(x,z)+height
        provenance.append({**record,'heightM':height,'heightConfidence':'provided_height' if valid else 'lamp_height_estimate','positionSource':'OpenStreetMap mapped street_lamp node'})
        for lod,size in [(0,500),(1,2000)]:
            key=f'l{lod}_x{math.floor(x/size)}_z{math.floor(z/size)}'
            by_lod[lod].setdefault(key,[]).append((x,y,z))
    previous={tile['meshes']['streetlights']['file'] for tile in manifest['tiles'] if 'streetlights' in tile['meshes']}
    if old:=manifest.get('streetlights',{}).get('file'): previous.add(old)
    chunks=0; rendered=0
    for tile in manifest['tiles']:
        tile['meshes'].pop('streetlights',None)
        points=by_lod.get(tile['lod'],{}).get(tile['id'],[])
        if not points: continue
        mesh=helpers['Mesh'](tile['ox'],tile['oz'])
        for x,y,z in points: mesh.vertex(x,y,z,[255,213,139])
        tile['meshes']['streetlights']=mesh.emit(f'{tile["id"]}/streetlights'); chunks+=1; rendered+=len(points)
    if rendered!=2*len(records): raise RuntimeError('Lamp nodes do not fit complete LOD0/1 coverage')
    source_file=helpers['emit_json']('sources',{'type':'mapped_streetlights','source':'osm','positions':'original WGS84 OSM node coordinates','coverage':'Mapped nodes only; not a comprehensive city lighting survey','heightConfidence':dict(confidence),'records':provenance})
    manifest['streetlights']={'file':source_file,'count':len(records),'lods':[0,1],'positionSource':'OSM mapped street_lamp nodes','heightConfidence':dict(confidence),'coverage':'Mapped nodes only, not a complete lighting survey','decorativePoints':0}
    manifest['stats']['streetlights']=len(records); manifest['stats']['streetlightChunks']=chunks
    manifest['stats']['vertices']=sum(mesh['v'] for tile in manifest['tiles'] for mesh in tile['meshes'].values())
    assets={row['file']:row for row in manifest['assets'] if row['file'] not in previous}
    assets.update({row['file']:{'file':row['file'],'hash':row['sha256'],'bytes':row['bytes']} for row in helpers['RESOURCES'].values()})
    manifest['assets']=sorted(assets.values(),key=lambda row:row['file'])
    manifest['dataEncoding']['streetlightPoints']='Same i16c mesh format; index count zero, positions relative to tile center, warm RGB uint8'
    manifest.pop('revision',None)
    manifest['revision']=hashlib.sha256(json.dumps(manifest,sort_keys=True,separators=(',',':')).encode()).hexdigest()[:20]
    (OUT/'manifest.json').write_text(json.dumps(manifest,ensure_ascii=False,separators=(',',':'),allow_nan=False))
    qa=json.loads((OUT/'data-qa.json').read_text()); qa['revision']=manifest['revision']; qa['stats']=manifest['stats']
    qa['checks']['streetlightsFromMappedOSMNodes']=len(records); qa['streetlights']=manifest['streetlights']
    qa['limitations']=[line for line in qa['limitations'] if not line.startswith('Streetlight positions')]+['Streetlight positions are mapped OSM points, not a complete lighting survey; unspecified lamp heights are explicitly estimated.']
    (OUT/'data-qa.json').write_text(json.dumps(qa,ensure_ascii=False,indent=2))
    (RAW/'streetlights.json').write_text(json.dumps(records,ensure_ascii=False,separators=(',',':')))
    print(f'Added {len(records)} mapped lamps to {chunks} LOD0/1 chunks; {rendered} rendered point copies, heights={dict(confidence)}, revision={manifest["revision"]}')

if __name__=='__main__': main()
