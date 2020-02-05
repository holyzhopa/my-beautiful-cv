import { LoadedModule, ModuleLoaderService } from "@app/services/module-loader/module-loader.service";
import {
  AdditionalDependencyType,
  DynamicFunctionData,
  FieldsDependencyToken,
  InjectableModule,
  InjectionType
} from "@app/services/module-loader/InjectionDependency";
import { Injector, OnInit, ViewContainerRef } from "@angular/core";
import { takeUntil } from "rxjs/operators";

export interface IDynamicLoadableModules {
  //todo add extends of IUnsubscribable for components or add boolean value to decorator?
  injector: Injector;
  loader: ModuleLoaderService;
  loadedModules: LoadedModule[];
  dynamicFunctions: DynamicFunctionData[];
  dynamicFields: FieldsDependencyToken[];
}

export interface IDynamicComponent extends IDynamicLoadableModules, OnInit {
  dynamicComponentsRef?: ViewContainerRef;
  dynamicComponents?: any[]; //todo ref
}

export interface IDynamicService extends IDynamicLoadableModules, OnInit {
}

/*
 NOTE: Components MUST have dynamicComponentsRef param where to inject new components(NOTE that ViewContainerRef inserts components as a siblings)
 Services MUST call ngOnInit method manually
*/
export function DynamicLoadableModules(): ClassDecorator {
  return function(constructor: any) {
    const initialFunction = constructor.prototype["ngOnInit"];
    constructor.prototype["ngOnInit"] = function() {
      initialFunction.call(this);
      subscribeToDependencies.call(this);
    };
  };
}

function subscribeToDependencies() {
  let loadedModulesSource = this.loader.loadedModules;
  if (isDestroyable(this)) {
    loadedModulesSource = loadedModulesSource.pipe(takeUntil(this.destroyed));
  }
  loadedModulesSource.subscribe((modules: LoadedModule[]) => {
    modules.forEach(module => {
      if (
        !(this as IDynamicLoadableModules).loadedModules.find(loadedModule => {
          return loadedModule.token === module.token;
        })
      ) {
        (this as IDynamicLoadableModules).loadedModules.push(module);
        (module.moduleRef.instance as InjectableModule).dependencies.forEach(dependency => {
          if (dependency.placesToInject.includes(this.token)) {
            switch (dependency.type) {
              case InjectionType.Component:
                const componentFactory = (module.moduleRef.instance as InjectableModule).componentFactories.find(factory => {
                  return factory.name === dependency.constructorName;
                });
                const component = componentFactory.instance.create(this.injector);
                (this as IDynamicComponent).dynamicComponentsRef.insert(component.hostView);
                (this as IDynamicComponent).dynamicComponents.push(component.instance);
                const bootstrapDependencies = dependency.additionalDependencies.filter(addDep => {
                  return addDep.type === AdditionalDependencyType.componentBootstrapFunction;
                });
                bootstrapDependencies.forEach(addDep => {
                  addDep.data.fnToCall(this);
                });
                break;
              case InjectionType.DynamicFunction:
                const alreadyDeclaredFunction =
                  this[dependency.dependencyName] ||
                  (this as IDynamicComponent).dynamicFunctions.find(registeredFunc => registeredFunc.name === dependency.dependencyName);
                if (alreadyDeclaredFunction) {
                  throw new Error(`Function ${dependency.dependencyName} already declared!`);
                }
                (this as IDynamicLoadableModules).dynamicFunctions.push({
                  name: `${(module.token as any)._desc as string}::${dependency.dependencyName}`,
                  instance: dependency.dependencyToken,
                  ctx: module.moduleRef.instance
                });
                break;
              case InjectionType.Fields:
                const arrayToPush = this[(dependency.dependencyToken as FieldsDependencyToken).arrayToPush] as any[];
                const valuesToPush = (dependency.dependencyToken as FieldsDependencyToken).values;
                arrayToPush.push(...valuesToPush);
                (this as IDynamicLoadableModules).dynamicFields.push(dependency.dependencyToken);
                break;
              case InjectionType.CallSelfFunction:
                this[dependency.dependencyToken].apply(this, dependency.functionParams);
                break;
            }
          }
        });
      }
    });
  });

  let pluginClearCaller = this.loader.callDynamicModulesClear;
  if (isDestroyable(this)) {
    pluginClearCaller = pluginClearCaller.pipe(takeUntil(this.destroyed));
  }
  pluginClearCaller.subscribe(() => {
    if ((this as IDynamicComponent).dynamicComponentsRef) {
      (this as IDynamicComponent).dynamicComponentsRef.clear();
    }
    (this as IDynamicLoadableModules).dynamicFunctions = [];

    (this as IDynamicLoadableModules).dynamicFields.forEach(fieldsToken => {
      fieldsToken.values.forEach(valueToDelete => {
        const deleteIndex = (this[fieldsToken.arrayToPush] as any[]).indexOf(valueToDelete);
        if (~deleteIndex) {
          (this[fieldsToken.arrayToPush] as any[]).splice(deleteIndex, 1);
        }
      });
    });
    (this as IDynamicLoadableModules).dynamicFields = [];
  });
}

export function isDestroyable(ctx): boolean {
  return ctx.ngOnDestroy !== undefined;
}
