import { runtimeStatus } from '../../server/nyoni-runtime.js';

export default function handler(_request, response) {
  response.setHeader('Cache-Control', 'no-store');
  response.status(200).json(runtimeStatus());
}
