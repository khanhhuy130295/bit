/** @flow */
import R from 'ramda';
import Extension from './extension';
import { loadConsumer, Consumer } from '../consumer';
import logger from '../logger/logger';

export default (async function loadExtensions(): Extension[] {
  try {
    const consumer: Consumer = await loadConsumer();
    const rawExtensions = consumer.bitJson.extensions || [];
    const extensions = R.values(R.mapObjIndexed(_loadExtension, rawExtensions));
    return extensions;
  } catch (err) {
    return [];
  }
});

function _loadExtension(rawConfig: Object, name: string) {
  return Extension.load(name, rawConfig);
}
