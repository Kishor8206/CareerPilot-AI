import mongoose, { type Model, type Schema } from 'mongoose';

/**
 * Idempotent model registration.
 *
 * `mongoose.model()` throws `OverwriteModelError` if the same name is
 * registered twice. That happens whenever a model module is evaluated more than
 * once against a single mongoose instance - under `tsx watch` hot reload, and
 * in test runners that isolate module graphs but share `node_modules`.
 *
 * Returning the already-registered model in that case is correct: the schema is
 * identical, and the compiled model is a singleton by design.
 */
export function registerModel<TDoc, TModel extends Model<TDoc> = Model<TDoc>>(
  name: string,
  schema: Schema<TDoc, TModel> | Schema<any, any, any>,
): TModel {
  const existing = mongoose.models[name] as TModel | undefined;
  if (existing) return existing;
  return mongoose.model<TDoc, TModel>(name, schema as Schema<TDoc, TModel>);
}
