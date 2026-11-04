import { farmMarkup } from './arkengine-farm.fixture.mjs';
import { stockMarkup } from './arkengine-stock.fixture.mjs';
import { shelterMarkup } from './arkengine-shelter.fixture.mjs';

// Compose the existing native-shaped pages without duplicating their state or action contracts.
if(!stockMarkup.startsWith(farmMarkup)||!shelterMarkup.startsWith(farmMarkup))throw Error('Fixture base changed');
export const crossFeatureMarkup=stockMarkup+shelterMarkup.slice(farmMarkup.length)+`<script>
window.renderFeature=()=>{if(location.pathname==='/stock')renderStock();else if(location.pathname==='/shelter')renderShelter();
  else if(location.pathname==='/farm')renderFarm();else renderExp();};
window.navFarm=path=>{fm.calls.push({type:'navigate',path});history.pushState({},'',path);renderFeature();};
renderFeature();
</script>`;
