import {StyleFactory} from './style-factory';
import {protocol, Origin} from 'aurelia-metadata';
import {PLATFORM} from 'aurelia-pal';
import {StyleLocator} from './style-locator';
import {relativeToFile} from 'aurelia-path';
import {Container} from 'aurelia-dependency-injection';
import {StyleCompiler} from './style-compiler';
import {Loader} from 'aurelia-loader';
import {AureliaUX} from '../aurelia-ux';

export interface StyleStrategy {
  moduleId?: string;
  loadStyleFactory(container: Container, styleObjectType: Function): Promise<StyleFactory>;
}

/**
 * Decorator: Indicates that the decorated class/object is a style strategy.
 */
export const styleStrategy: Function = (<any>protocol).create('aurelia:style-strategy', {
  validate(target: any): string | boolean {
    if (!(typeof target.loadStyleFactory === 'function')) {
      return 'Style strategies must implement: loadStyleFactory(): Promise<StyleFactory>';
    }

    return true;
  },
  compose(target: any) {
    if (!(typeof target.makeRelativeTo === 'function')) {
      target.makeRelativeTo = PLATFORM.noop;
    }
  }
});

let cssUrlMatcher = /url\((?!['"]data)([^)]+)\)/gi;

function fixupCSSUrls(address: string, css: string) {
  if (typeof css !== 'string') {
    throw new Error(`Failed loading required CSS file: ${address}`);
  }

  return css.replace(cssUrlMatcher, (_, p1) => {
    let quote = p1.charAt(0);

    if (quote === '\'' || quote === '"') {
      p1 = p1.substr(1, p1.length - 2);
    }

    return 'url(\'' + relativeToFile(p1, address) + '\')';
  });
}

/**
 * A style strategy that loads a style relative to its associated view-model.
 */
@styleStrategy()
export class RelativeStyleStrategy implements StyleStrategy {
  private path: string;
  private absolutePath: string | null;
  private css: string;
  public moduleId: string;

  /**
   * Creates an instance of RelativeStyleStrategy.
   * @param path The relative path to the styles.
   */
  constructor(private pathOrDesignMap: string | any) {
    this.absolutePath = null;
  }

  /**
   * Loads a style factory.
   */
  public loadStyleFactory(container: Container, styleObjectType: Function): Promise<StyleFactory> {
    if (this.absolutePath === null && this.moduleId) {
      let path = resolveForDesign(this.pathOrDesignMap, container);

      if (!path) {
        this.absolutePath = (<StyleLocator>container.get(StyleLocator))
          .convertOriginToStyleUrl(new Origin(this.moduleId, 'default'));
      } else {
        this.absolutePath = relativeToFile(path, this.moduleId);
      }
    }

    let styleUrl = this.absolutePath || resolveForDesign(this.pathOrDesignMap, container);

    return container.get(Loader)
      .loadText(styleUrl)
      .catch(() => null)
      .then((text: string) => {
        text = fixupCSSUrls(styleUrl, text);
        this.css = text;
        let compiler = <StyleCompiler>container.get(StyleCompiler);
        return compiler.compile(styleObjectType, this.css);
      });
  }

  /**
   * Makes the view loaded by this strategy relative to the provided file path.
   * @param file The path to load the view relative to.
   */
  public makeRelativeTo(file: string): void {
    if (this.absolutePath === null) {
      this.absolutePath = relativeToFile(this.path, file);
    }
  }
}

/**
 * A styles strategy based on naming conventions.
 */
@styleStrategy()
export class ConventionalStyleStrategy implements StyleStrategy {
  public moduleId: string;
  private styleUrl: string;
  private css: string;

  /**
   * Creates an instance of ConventionalStyleStrategy.
   * @param viewLocator The view locator service for conventionally locating the view.
   * @param origin The origin of the view model to conventionally load the view for.
   */
  constructor(styleLocator: StyleLocator, origin: Origin) {
    this.moduleId = origin.moduleId;
    this.styleUrl = styleLocator.convertOriginToStyleUrl(origin);
  }

  /**
   * Loads a style factory.
   */
  public loadStyleFactory(container: Container, styleObjectType: Function): Promise<StyleFactory> {
    return container.get(Loader)
      .loadText(this.styleUrl)
      .catch(() => null)
      .then((text: string) => {
        text = fixupCSSUrls(this.styleUrl, text);
        this.css = text;
        let compiler = <StyleCompiler>container.get(StyleCompiler);
        return compiler.compile(styleObjectType, this.css);
      });
  }
}

/**
 * A styles strategy that allows the component author to inline css.
 */
@styleStrategy()
export class InlineStyleStrategy implements StyleStrategy {
  public moduleId: string;
  private transformedCSS: string;

  /**
   * Creates an instance of InlineStyleStrategy.
   */
  constructor(private cssOrDesignMap: string | any) {}

  /**
   * Loads a style factory.
   */
  public loadStyleFactory(container: Container, styleObjectType: Function): Promise<StyleFactory> {
    let css = resolveForDesign(this.cssOrDesignMap, container);
    this.transformedCSS = fixupCSSUrls(this.moduleId, css);
    let compiler = <StyleCompiler>container.get(StyleCompiler);
    return Promise.resolve(compiler.compile(styleObjectType, this.transformedCSS));
  }
}

function resolveForDesign(valueOrDesignMap: string | any, container: Container): string {
  if (typeof valueOrDesignMap === 'string') {
    return valueOrDesignMap;
  } else {
    let designType = (<AureliaUX>container.get(AureliaUX)).design.type;
    return valueOrDesignMap[designType];
  }
}
