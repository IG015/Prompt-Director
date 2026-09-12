import { database } from "@/lib/storage";
export async function GET(){try{const row=await database().prepare("SELECT data FROM studio WHERE id = ?").bind("main").first<{data:string}>();return Response.json(row?JSON.parse(row.data):null);}catch(e){console.error(e);return Response.json({error:"Não foi possível carregar o estúdio."},{status:503});}}
type Asset={id:string;name:string;type:string;kind?:string};
type Version={id:string;label:string;active?:boolean;createdAt?:string;promptAnchor?:string;immutable?:string;allowed?:string;forbidden?:string;references?:Asset[]};
type Bible={id:string;name:string;role?:string;description?:string;age?:string;dominantHand?:string;persistentObjects?:string;activeVersionId?:string;knownFailures?:string[];versions?:Version[]};
type Take={id:string;provider:string;model?:string;status:string;prompt?:string;createdAt?:string;outputAsset?:Asset;finalFrame?:Asset;rejectionReasons?:string[];notes?:string;estimatedCost?:number;actualCost?:number};
type Shot={id:string;title?:string;sceneNumber?:number;shotNumber?:number;action?:string;camera?:string;duration?:string;durationMode?:string;continuity?:string;negative?:string;storyboard?:Asset;assets?:Asset[];status?:string;qualityTarget?:string;preferredProvider?:string;transitionType?:string;characterVersionIds?:string[];locationVersionId?:string;preparedPrompt?:string;approvedTakeId?:string;takes?:Take[]};
type Prop={id:string;name:string;description?:string;rules?:string;status?:string};
type Project={title?:string;style?:string;styleNegative?:string;storyRules?:string;continuityRules?:string;budgetMode?:string;scenes?:Shot[];characters?:Bible[];locations?:Bible[];props?:Prop[]};

function text(value:unknown){return typeof value==="string"?value:"";}
function iso(value?:string){return value && !Number.isNaN(Date.parse(value))?value:new Date().toISOString();}

export async function PUT(req:Request){
  try{
    const data=await req.json() as Project;
    const raw=JSON.stringify(data);
    if(!Array.isArray(data.scenes)||data.scenes.length<1||data.scenes.length>100||raw.length>2000000)return Response.json({error:"Projeto inválido ou demasiado grande."},{status:400});
    const db=database();
    const now=new Date().toISOString();
    const queries=[
      db.prepare("INSERT INTO studio (id,data) VALUES (?,?) ON CONFLICT(id) DO UPDATE SET data=excluded.data").bind("main",raw),
      db.prepare("INSERT INTO series_projects (id,title,budget_mode,updated_at) VALUES (?,?,?,?) ON CONFLICT(id) DO UPDATE SET title=excluded.title,budget_mode=excluded.budget_mode,updated_at=excluded.updated_at").bind("main",text(data.title)||"Projeto sem título",text(data.budgetMode)||"BALANCED",now),
      db.prepare("INSERT INTO episodes (id,project_id,season_number,episode_number,title,context) VALUES (?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET title=excluded.title,context=excluded.context").bind("episode-main","main",1,1,"Episódio 01",JSON.stringify({storyRules:text(data.storyRules),continuityRules:text(data.continuityRules),props:data.props||[]})),
      db.prepare("INSERT INTO style_bibles (id,project_id,visual_style,negative_constraints) VALUES (?,?,?,?) ON CONFLICT(id) DO UPDATE SET visual_style=excluded.visual_style,negative_constraints=excluded.negative_constraints").bind("style-main","main",text(data.style),text(data.styleNegative)),
    ];
    for(const [index,shot] of data.scenes.entries()){
      const specification=JSON.stringify({action:text(shot.action),camera:text(shot.camera),duration:text(shot.duration),durationMode:text(shot.durationMode),continuity:text(shot.continuity),negative:text(shot.negative),transitionType:text(shot.transitionType),storyboard:shot.storyboard||null,characterVersionIds:shot.characterVersionIds||[],locationVersionId:text(shot.locationVersionId),preparedPrompt:text(shot.preparedPrompt)});
      queries.push(db.prepare("INSERT INTO production_scenes (id,episode_id,scene_number,title,context) VALUES (?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET scene_number=excluded.scene_number,title=excluded.title,context=excluded.context").bind(shot.id,"episode-main",shot.sceneNumber||1,text(shot.title)||`Cena ${index+1}`,text(shot.continuity)));
      queries.push(db.prepare("INSERT INTO shots (id,scene_id,shot_number,specification,status,quality_target,preferred_provider,approved_take_id) VALUES (?,?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET shot_number=excluded.shot_number,specification=excluded.specification,status=excluded.status,quality_target=excluded.quality_target,preferred_provider=excluded.preferred_provider,approved_take_id=excluded.approved_take_id").bind(shot.id,shot.id,shot.shotNumber||index+1,specification,text(shot.status)||"DRAFT",text(shot.qualityTarget)||"STANDARD",text(shot.preferredProvider)||null,text(shot.approvedTakeId)||null));
      for(const take of shot.takes||[]) queries.push(db.prepare("INSERT INTO takes (id,shot_id,provider,model,status,prompt,parameters,reference_assets,output_asset_id,final_frame_asset_id,rejection_reasons,notes,estimated_cost,actual_cost,created_at,completed_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET status=excluded.status,output_asset_id=excluded.output_asset_id,final_frame_asset_id=excluded.final_frame_asset_id,rejection_reasons=excluded.rejection_reasons,notes=excluded.notes,actual_cost=excluded.actual_cost,completed_at=excluded.completed_at").bind(take.id,shot.id,text(take.provider)||"manual",text(take.model),text(take.status)||"REVIEW",text(take.prompt),"{}",JSON.stringify(shot.assets||[]),take.outputAsset?.id||null,take.finalFrame?.id||null,JSON.stringify(take.rejectionReasons||[]),text(take.notes),take.estimatedCost==null?null:String(take.estimatedCost),take.actualCost==null?null:String(take.actualCost),iso(take.createdAt),take.status==="APPROVED"||take.status==="REJECTED"?now:null));
    }
    for(const character of data.characters||[]){
      queries.push(db.prepare("INSERT INTO character_bibles (id,project_id,canonical_name,role,description) VALUES (?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET canonical_name=excluded.canonical_name,role=excluded.role,description=excluded.description").bind(character.id,"main",character.name,text(character.role),text(character.description)));
      for(const version of character.versions||[]){
        queries.push(db.prepare("INSERT INTO character_versions (id,character_id,label,prompt_anchor,immutable_traits,allowed_variations,forbidden_variations) VALUES (?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET label=excluded.label,prompt_anchor=excluded.prompt_anchor,immutable_traits=excluded.immutable_traits,allowed_variations=excluded.allowed_variations,forbidden_variations=excluded.forbidden_variations").bind(version.id,character.id,version.label,text(version.promptAnchor),text(version.immutable),text(version.allowed),text(version.forbidden)));
        for(const asset of version.references||[]) queries.push(db.prepare("INSERT INTO assets (id,project_id,owner_type,owner_id,kind,name,mime_type,storage_key,created_at) VALUES (?,?,?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET owner_type=excluded.owner_type,owner_id=excluded.owner_id,kind=excluded.kind,name=excluded.name,mime_type=excluded.mime_type").bind(asset.id,"main","CHARACTER_VERSION",version.id,text(asset.kind)||"MASTER_REFERENCE",asset.name,asset.type,asset.id,now));
      }
    }
    for(const location of data.locations||[]){
      queries.push(db.prepare("INSERT INTO location_bibles (id,project_id,name,description) VALUES (?,?,?,?) ON CONFLICT(id) DO UPDATE SET name=excluded.name,description=excluded.description").bind(location.id,"main",location.name,text(location.description)));
      for(const version of location.versions||[]){
        queries.push(db.prepare("INSERT INTO location_versions (id,location_id,label,prompt_anchor,immutable_features,allowed_variations,forbidden_variations) VALUES (?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET label=excluded.label,prompt_anchor=excluded.prompt_anchor,immutable_features=excluded.immutable_features,allowed_variations=excluded.allowed_variations,forbidden_variations=excluded.forbidden_variations").bind(version.id,location.id,version.label,text(version.promptAnchor),text(version.immutable),text(version.allowed),text(version.forbidden)));
        for(const asset of version.references||[]) queries.push(db.prepare("INSERT INTO assets (id,project_id,owner_type,owner_id,kind,name,mime_type,storage_key,created_at) VALUES (?,?,?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET owner_type=excluded.owner_type,owner_id=excluded.owner_id,kind=excluded.kind,name=excluded.name,mime_type=excluded.mime_type").bind(asset.id,"main","LOCATION_VERSION",version.id,text(asset.kind)||"MASTER",asset.name,asset.type,asset.id,now));
      }
    }
    await db.batch(queries);
    return Response.json({ok:true});
  }catch(e){console.error(e);return Response.json({error:"Não foi possível guardar. O teu texto continua no editor."},{status:503});}
}
