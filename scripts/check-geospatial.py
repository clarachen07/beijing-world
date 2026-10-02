"""Independent geographic QA; reads existing source/build artifacts, never fetches."""
import json, math, gzip, hashlib, struct
from collections import Counter
from pathlib import Path
import osmium
import numpy as np
from shapely.geometry import shape, Point, Polygon, box
from shapely.affinity import affine_transform
from shapely import normalize, STRtree, make_valid
from shapely.ops import unary_union

ROOT=Path(__file__).resolve().parents[1]; OUT=ROOT/'public/data'; RAW=ROOT/'raw/geospatial'
def read_json_asset(path):
    data=path.read_bytes()
    return json.loads(gzip.decompress(data) if data[:2]==b'\x1f\x8b' else data)
manifest=json.loads((OUT/'manifest.json').read_text()); cfg=json.loads((ROOT/'config/world.json').read_text())
report={'revision':manifest['revision'],'checks':{},'warnings':[]}
def check(name,condition,detail=None):
    if not condition: raise AssertionError(f'{name}: {detail}')
    if not name.startswith(('ground_grid_','valid_collision_','valid_water_holes_','min_height_','height_basis_')):
        report['checks'][name]={'passed':True,'detail':detail}

boundary_record=json.loads((OUT/manifest['coverage']['boundaryFile']).read_text()); boundary=shape(boundary_record['geometry'])
lamps=read_json_asset(OUT/manifest['streetlights']['file'])['records'] if manifest.get('streetlights') else []
lamp_lookup={int(row['id'].split('/')[1]):(row['lon'],row['lat']) for row in lamps}; actual_lamps={}
cycles=json.loads((RAW/'fourth-ring-nodes.json').read_text())['cycles']
check('boundary_closed_and_valid',boundary.is_valid and boundary.exterior.is_ring and boundary.exterior.coords[0]==boundary.exterior.coords[-1])
check('both_carriageways_closed',len(cycles)==2 and all(c['nodes'][0]==c['nodes'][-1] and len(c['nodes'])>100 for c in cycles))
check('boundary_contains_inner_city',boundary.contains(Point(116.391,39.907)))
needed=set(identifier for cycle in cycles for identifier in cycle['wayIds']); real_edges=set(); node_points={}; ways_found=set()
class RingSource(osmium.SimpleHandler):
    def node(self,node):
        if node.id in lamp_lookup: actual_lamps[node.id]=(node.location.lon,node.location.lat)
    def way(self,way):
        if way.id not in needed: return
        ways_found.add(way.id); refs=[node.ref for node in way.nodes]
        for a,b in zip(refs,refs[1:]): real_edges.add(tuple(sorted((a,b))))
        for node in way.nodes: node_points[node.ref]=(node.lon,node.lat)
handler=RingSource(); handler.apply_file(str(RAW/'Beijing.osm.pbf'),locations=True)
check('boundary_way_ids_in_source_pbf',needed==ways_found,{'expected':len(needed),'found':len(ways_found)})
check('all_boundary_edges_real_osm_nodes',all(tuple(sorted((a,b))) in real_edges for cycle in cycles for a,b in zip(cycle['nodes'],cycle['nodes'][1:])))
check('exported_boundary_matches_node_coordinates',list(boundary.exterior.coords)==[node_points[node] for node in cycles[0]['nodes']])
origin=manifest['origin']; mx=111320*math.cos(math.radians(origin['lat'])); mz=cfg['projection']['metresPerDegreeLat']
affine=[mx,0,0,-mz,-origin['lon']*mx,origin['lat']*mz]
registry_bytes=(ROOT/'config/landmarks.json').read_bytes(); registry=json.loads(registry_bytes)['landmarks']
model_masks=[(item['id'],unary_union([affine_transform(make_valid(Polygon(coords)),affine) for coords in item.get('footprints',[])])) for item in registry if item.get('model') and item.get('footprints')]
mask_geometries=[mask for _,mask in model_masks]; mask_tree=STRtree(mask_geometries)
replaced_ids={identifier for item in registry if item.get('model') for identifier in item.get('replacesOSMIds',[])}
coverage=manifest.get('landmarkCoverage',{})
check('landmark_masks_match_frozen_model_registry',coverage.get('registrySha256')==hashlib.sha256(registry_bytes).hexdigest())
adjustments=read_json_asset(OUT/coverage['file'])
check('landmark_mask_audit_matches_registry',adjustments['registrySha256']==coverage['registrySha256'])
mesh_masks=[geometry.buffer(-.3) for geometry in mask_geometries]
# 0.2m mesh positions can move a boundary by up to sqrt(2)*0.1m.
# Collision/provenance retain doubles and are checked against the exact boundary.
mesh_mask_tree=STRtree(mesh_masks)
scope=affine_transform(boundary,affine).buffer(cfg.get('scopeBufferM',0)).union(affine_transform(box(*cfg['extensionBounds']),affine))
check('metric_500m_visual_buffer',cfg.get('scopeBufferM')==manifest['coverage'].get('bufferM')==500)
check('boundary_unique_nodes',boundary_record['properties'].get('uniqueNodeCount')==len(set(cycles[0]['nodes']))==424)
check('boundary_area_reasonable',250e6<affine_transform(boundary,affine).area<400e6,{'areaKm2':round(affine_transform(boundary,affine).area/1e6,3)})
tiles=manifest['tiles']; ids={tile['id'] for tile in tiles}
check('unique_tile_ids',len(ids)==len(tiles))
check('hierarchy_children_exist',all(child in ids for tile in tiles for child in tile.get('children',[])))
leaf_keys={(round(tile['bounds'][0]/500),round(tile['bounds'][1]/500)) for tile in tiles if tile['lod']==0}
expected=set(); w,s,e,n=scope.bounds
for x in range(math.floor(w/500),math.floor(e/500)+1):
    for z in range(math.floor(s/500),math.floor(n/500)+1):
        if box(x*500,z*500,(x+1)*500,(z+1)*500).intersects(scope): expected.add((x,z))
check('complete_leaf_spatial_coverage',leaf_keys==expected,{'expected':len(expected),'actual':len(leaf_keys)})
sources={source['id']:source for source in manifest['sources']}
check('required_source_acquisition_complete',all(sources[key]['complete'] for key in ['osm','overture','dem','imagery']),{key:source['complete'] for key,source in sources.items()})
check('required_sources_include_visual_buffer',all(sources[key].get('scopeBufferM')==cfg['scopeBufferM'] for key in ['osm','overture']))
check('pinned_source_dates',sources['overture']['release']==cfg['overtureRelease'] and sources['imagery']['date']==cfg['imagery']['date'] and sources['osm']['date'].startswith('2026-09-'))
check('synthetic_buildings_absent',manifest['stats'].get('infill',-1)==0 and cfg['allowSyntheticBuildings'] is False)
check('all_tiles_complete',all(tile.get('complete') is True for tile in tiles))
if manifest.get('streetlights'):
    check('streetlights_match_actual_osm_nodes',actual_lamps==lamp_lookup and len(lamps)==len(lamp_lookup))
    check('streetlight_heights_have_confidence',all(row['heightM']>0 and row['heightConfidence'] in ('provided_height','lamp_height_estimate') for row in lamps))
    point_counts=Counter()
    for tile in tiles:
        if light:=tile['meshes'].get('streetlights'):
            check('streetlight_chunks_are_points',light['i']==0); point_counts[tile['lod']]+=light['v']
    check('streetlight_lod_coverage',point_counts[0]==point_counts[1]==len(lamps)==manifest['streetlights']['count'] and point_counts[2]==0,dict(point_counts))
records=Counter(); confidence=Counter(); attributes=Counter(); duplicate_extents=0; collision_count=0; hole_count=0; water_holes=0
published_ids=set(); overlaps=[]; roof_samples={}; roof_shapes=Counter()
for tile in tiles:
    if tile['lod']!=0: continue
    collision=read_json_asset(OUT/tile['collision']['file']); index=read_json_asset(OUT/tile['sourceIndex']['file'])
    ground=collision['ground']; vals=ground['heights']
    check(f'ground_grid_{tile["id"]}',len(vals)==ground['width']*ground['height'] and all(math.isfinite(v) for v in vals) and ground['origin']==tile['bounds'][:2] and ground['step']*(ground['width']-1)==tile['size'])
    seen=set()
    water_inner=collision.get('waterHoles',[])
    check(f'valid_water_holes_{tile["id"]}',len(water_inner)==len(collision['water']))
    for outer,inner in zip(collision['water'],water_inner):
        check(f'valid_water_holes_{tile["id"]}',Polygon(outer,inner).is_valid)
        water_holes+=len(inner)
    for record in collision['buildings']:
        polygon=Polygon(record['polygon'],record.get('holes',[])); collision_count+=1; hole_count+=len(record.get('holes',[]))
        check(f'valid_collision_{tile["id"]}_{collision_count}',polygon.is_valid and record['maxY']>record['minY'] and math.isfinite(record['minY']) and math.isfinite(record['maxY']))
        key=(normalize(polygon).wkb,round(record['minY'],3),round(record['maxY'],3))
        if key in seen: duplicate_extents+=1
        seen.add(key)
        for i in mask_tree.query(polygon,predicate='intersects'):
            area=polygon.intersection(mask_geometries[int(i)]).area
            if area>1e-5: overlaps.append({'id':record['id'],'landmark':model_masks[int(i)][0],'overlapM2':area})
        if record['id'] in ('relation/8854351','way/638473470'):roof_samples[record['id']]={'tile':tile['id'],'geometry':polygon,'minY':record['minY'],'maxY':record['maxY']}
    for record in index:
        published_ids.add((record['source'],record['id']))
        records[record['source']]+=1; confidence[record['heightConfidence']]+=1
        roof_geometry=record.get('roofGeometry');check(f'height_basis_{tile["id"]}_{sum(records.values())}_roof',roof_geometry is not None and roof_geometry['effectiveRoofHeightM']>=0)
        roof_shapes[roof_geometry['shape']]+=1
        check(f'min_height_{tile["id"]}_{len(records)}_{sum(records.values())}',record['height']>record['minHeight']>=0)
        basis=record.get('heightInferenceBasis')
        check(f'height_basis_{tile["id"]}_{sum(records.values())}',basis is not None and 'floors' in record and 'use' in record and basis['renderedHeightM']==record['height'] and basis['sourceFloors']==record['floors'])
        if basis['originalMethod']=='floor_count_estimate':
            check(f'height_basis_{tile["id"]}_{sum(records.values())}',basis['metresPerFloor']==3.2 and record['floors'] is not None)
            original=record['floors']*basis['metresPerFloor']+basis['roofHeightAddedM']
        elif basis['originalMethod']=='provided_height': original=basis['sourceHeightM']
        else: original=basis['defaultHeightM']
        check(f'height_basis_{tile["id"]}_{sum(records.values())}',math.isclose(original,basis['heightBeforePartCapM'],abs_tol=.001))
        expected_height=min(original,basis['parentPartBaseCapM']) if basis['parentPartBaseCapM'] is not None else original
        if expected_height<=record['minHeight']: expected_height=record['minHeight']+3
        check(f'height_basis_{tile["id"]}_{sum(records.values())}',math.isclose(expected_height,record['height'],abs_tol=.001))
        attributes['floorsPresent' if record['floors'] is not None else 'floorsNull']+=1
        attributes['usePresent' if record['use'] is not None else 'useNull']+=1
check('collision_and_provenance_counts',collision_count==sum(records.values())==manifest['stats']['buildings'],{'collisionRecords':collision_count,'sourceRecords':sum(records.values()),'sources':dict(records)})
check('no_identical_building_volume_duplicates',duplicate_extents==0,{'identicalFootprintAndVerticalExtent':duplicate_extents})
check('no_city_volumes_overlap_registered_models',not overlaps,{'overlaps':overlaps[:20],'exactFootprints':len(model_masks),'collisionToleranceM2':1e-5})
check('replaced_osm_ids_absent',not {identifier for source,identifier in published_ids if source=='osm'}.intersection(replaced_ids))
taihe_parts={'way/638449346','way/638449348','way/638449349','way/638449350','way/638449352','way/638449353','way/638449354','way/638449447'}
check('taihe_roof_body_and_terrace_duplicates_absent',all(('osm',identifier) not in published_ids for identifier in taihe_parts),{'verifiedSourceParts':sorted(taihe_parts)})
check('taihe_unmodelled_neighbors_retained',all(('osm',identifier) in published_ids for identifier in ['way/638449345','way/638449315','way/638449443','relation/8854309']))

def read_mesh(tile,layer):
    chunk=tile['meshes'].get(layer)
    if not chunk:return None,None
    data=gzip.decompress((OUT/chunk['file']).read_bytes());count,index_count=struct.unpack_from('<II',data)
    positions=np.frombuffer(data,dtype='<i2',count=count*3,offset=8).reshape(-1,3).astype(np.float64)*.2
    positions[:,0]+=tile['ox'];positions[:,2]+=tile['oz']
    indices=np.frombuffer(data,dtype='<u4',count=index_count,offset=8+count*9).reshape(-1,3)
    return positions,indices

mesh_overlaps=[]; projected_checked=Counter(); roofs_checked={identifier:{} for identifier in roof_samples}
for tile in tiles:
    for layer in ('buildings','roofs'):
        positions,indices=read_mesh(tile,layer)
        if positions is None or not len(indices):continue
        p2=positions[:,[0,2]];extent=box(float(p2[:,0].min()),float(p2[:,1].min()),float(p2[:,0].max()),float(p2[:,1].max()))
        relevant=list(mesh_mask_tree.query(extent,predicate='intersects'))
        samples=[(identifier,sample) for identifier,sample in roof_samples.items() if tile['lod']<2 and extent.intersects(sample['geometry'])]
        if not relevant and not samples:continue
        triangles=positions[indices];xz=triangles[:,:,[0,2]];low=xz.min(axis=1);high=xz.max(axis=1)
        area=np.abs((xz[:,1,0]-xz[:,0,0])*(xz[:,2,1]-xz[:,0,1])-(xz[:,1,1]-xz[:,0,1])*(xz[:,2,0]-xz[:,0,0]))*.5
        for i in relevant:
            mask=mesh_masks[int(i)];x0,z0,x1,z1=mask.bounds
            candidate=np.flatnonzero((area>.001)&(high[:,0]>x0)&(high[:,1]>z0)&(low[:,0]<x1)&(low[:,1]<z1))
            projected_checked[tile['lod']]+=len(candidate)
            for j in candidate:
                overlap=Polygon(xz[j]).intersection(mask).area
                if overlap>.01:mesh_overlaps.append({'tile':tile['id'],'layer':layer,'landmark':model_masks[int(i)][0],'overlapM2':overlap})
        for identifier,sample in samples:
            mask=sample['geometry'].buffer(-.3);x0,z0,x1,z1=mask.bounds
            candidate=np.flatnonzero((high[:,0]>x0)&(high[:,1]>z0)&(low[:,0]<x1)&(low[:,1]<z1)&(triangles[:,:,1].max(axis=1)>sample['minY']+.3))
            result=roofs_checked[identifier].setdefault(tile['lod'],{'pitchedRoofTriangles':0,'windowWallTrianglesAboveEaves':0,'lowestRoofY':None,'highestRoofY':None})
            for j in candidate:
                # Roof caps have positive projected area. Vertical walls can
                # project to a line and are tested by the triangle centroid.
                inside=Polygon(xz[j]).intersection(mask).area>.01 if area[j]>.001 else mask.contains(Point(*xz[j].mean(axis=0)))
                if not inside:continue
                if layer=='buildings':result['windowWallTrianglesAboveEaves']+=1
                elif np.ptp(triangles[j,:,1])>.5:
                    result['pitchedRoofTriangles']+=1;lo=float(triangles[j,:,1].min());hi=float(triangles[j,:,1].max())
                    result['lowestRoofY']=lo if result['lowestRoofY'] is None else min(lo,result['lowestRoofY'])
                    result['highestRoofY']=hi if result['highestRoofY'] is None else max(hi,result['highestRoofY'])
check('all_lod_meshes_clear_model_interiors',not mesh_overlaps,{'overlaps':mesh_overlaps[:20],'candidateTrianglesByLod':dict(projected_checked),'boundaryEncodingAllowanceM':.3})
check('baohe_zhonghe_source_roof_examples_exist',set(roof_samples)=={'relation/8854351','way/638473470'})
for identifier,results in roofs_checked.items():
    check(f'pitched_roof_{identifier}',set(results)=={0,1} and all(value['pitchedRoofTriangles']>0 and value['windowWallTrianglesAboveEaves']==0 and value['highestRoofY']>=roof_samples[identifier]['maxY']-.3 for value in results.values()),results)
roots=[]
for tile in tiles:
    if tile['lod']!=2: continue
    files=[mesh['file'] for mesh in tile['meshes'].values()]+[tile['ground']['mesh']['file'],tile['ground']['texture']['file']]
    size=sum((OUT/file).stat().st_size for file in files); roots.append({'id':tile['id'],'bytes':size})
check('far_tile_budget',all(root['bytes']<=1024*1024 for root in roots),roots)
report['summary']={'tilesByLod':dict(Counter(tile['lod'] for tile in tiles)),'sourceBuildingCounts':dict(records),'heightConfidence':dict(confidence),'sourceAttributeCounts':dict(attributes),'courtyardHoles':hole_count,'waterIslandHoles':water_holes,'roofShapeCounts':dict(roof_shapes),'roofExamples':roofs_checked,'farTileBytes':roots,'manifestBytes':(OUT/'manifest.json').stat().st_size,'largestFarTileBytes':max(root['bytes'] for root in roots)}
report['warnings']=['Missing source heights are marked estimated; this is not a surveyed city-wide height database.','Sentinel 10m imagery cannot provide facade detail.','Smoothed Copernicus DSM is estimated ground, not a bare-earth survey.']
# Store compact QA, rather than every successful per-building assertion.
report['checks']={key:value for key,value in report['checks'].items() if not key.startswith(('ground_grid_','valid_collision_','valid_water_holes_','min_height_','height_basis_'))}
report['checks']['all_collision_polygons_and_ground_samples_valid']={'passed':True,'detail':collision_count}
report['checks']['height_inference_values_recalculate_rendered_heights']={'passed':True,'detail':sum(records.values())}
(OUT/'geospatial-qa.json').write_text(json.dumps(report,ensure_ascii=False,indent=2))
print(json.dumps(report['summary'],ensure_ascii=False,indent=2)); print('Geospatial QA passed')
