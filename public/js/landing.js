// Draws the placeholder example postcards on the landing page.
import { displayText } from '/shared/layout.js';
import { mountPostcard } from './postcard.js';

for (const el of document.querySelectorAll('.pc-sample')) {
  const { orientation, location, keywords = '', month, year } = el.dataset;
  const card = mountPostcard(el, { stampLabel: 'stamp' });
  card.setOrientation(orientation);
  card.setText(displayText({ location, keywords: keywords.split(','), month, year }));
}
