import { html } from '../util.js';
import { icon } from '../components.js';

export function notFound(root, message = "We looked under the grill, in the minivan and behind the couch. Nothing.") {
  document.title = 'Not found · SignMeUpDaddy';
  root.innerHTML = html`<div class="container narrow center-page">
    <p class="big-emoji" aria-hidden="true">🔦</p>
    <h1 tabindex="-1">Hmm, can't find that one.</h1>
    <p class="lede">${message}</p>
    <div class="btn-row center-row">
      <a class="btn btn-primary" href="#/">${icon('arrowL')} Back home</a>
      <a class="btn btn-ghost" href="#/new">Create a sheet</a>
    </div>
  </div>`.s;
}
