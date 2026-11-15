import {createShelterDevelopmentSelection} from './arkengine-shelter-development-selection.mjs';
import {createShelterRouteSimulation} from './arkengine-shelter-route-simulation.mjs';

// This endpoint only proposes. It cannot access storage, DOM controls or native requests.
export function installShelterPlanningWorker(endpoint) {
  const selection=createShelterDevelopmentSelection();
  endpoint.onmessage=({data})=>{
    const {id,options,resume}=data;
    try {
      const node=data.runtime?createShelterRouteSimulation().fromRuntime(data.runtime.view,data.runtime.options).node:data.node;
      const result=data.mode==='local'?selection.selectLocal(node,options):
        resume?selection.continueSelection(resume,options):selection.select(node,options);
      const prepared=selection.prepareSelected(resume?.node??node,result);
      endpoint.postMessage({id,result,prepared:{accepted:prepared.accepted,action:prepared.action??null,blocked:prepared.blocked}});
    } catch(error) {endpoint.postMessage({id,error:String(error?.message??error)});}
  };
}
