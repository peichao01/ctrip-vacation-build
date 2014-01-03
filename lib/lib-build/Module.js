var pth = require('path');
var fs = require('fs');
var buildUtil = require('./util');

var _mid = 0;

var canNew = false;

var moduleCaches = {},
	uriCaches = {};
var TPL_TYPE = ['html','tpl','hbs','handlebars'];
var IS_TPL = new RegExp("\\.("+TPL_TYPE.join('|')+")(\\.js)?$");

function getMid(){
	return 'm' + _mid++;
}

/**
 *
 * @param {String} uri
 * @param {Boolean} isMain
 * @constructor
 */
function Module(opt){
	this.uri = opt.uri;
	this.isMain = opt.isMain;

	if(this.uri.indexOf('http://') == 0){
		this.isRemote = true;
		return;
	}

	this._check();
	// linux 风格路径
	this.uri_nux = buildUtil.normalize_win_dir(this.uri);
	this.mid = getMid();
	this.baseInfo().dealDependency().deepDependencies();//.transport();
}

Module.prototype.setPackage = function(package){
	this.package = package;
	return this;
};

Module.prototype._check = function(){
	if(!canNew) vacation.log.error('you should use Module.get to initialize a Module.');

	var tpl;
	if(tpl = this.uri.match(IS_TPL)){
		this.isTpl = true;
		// uri 需要去除 .js 结尾
		if(tpl[2]){
			this.uri = this.uri.substr(0, this.uri.length - 3);
		}
	}

	// uri 被缓存，但模块没有被缓存，一定是循环引用了
	if(uriCaches[this.uri]) vacation.log.error('circle dependencies.');
	uriCaches[this.uri] = true;

	// 检查依赖文件是否存在
	var depIsExists = fs.existsSync(this.uri);
	if(!depIsExists) {
		vacation.log.error('[425-1] module('+this.id+') deps on ('+this.uri+'), but this file is not exists.');
	}
	return this;
};

Module.prototype.baseInfo = function(){
	var uri = this.uri;
	var conf = buildUtil.getBuildConfig();
	// 顶级标识都必须相对于 base 路径来解析
	var relative = pth.relative(conf.base, uri);
	var moduleId, idType;

	var matched = [];
	// real_alias_rootPathed 已经将 alias、paths 基于 configFileDir 转为根路径
	buildUtil.each(conf.real_alias_rootPathed, function(aliasRootPath, key){
		if(pth.relative(aliasRootPath, uri).indexOf('.') !== 0)
			matched.push([key, aliasRootPath]);
	});
	// 此模块有设置 alias 或 pahts
	if(matched.length > 0){
		// 按 aliasRootPath 的长度排序，越长越靠前。
		matched.sort(function(a,b){
			return a[1].length - b[1].length < 0;
		});
		// resolve 返回的结果(matched[0][1])，是已经去除掉最后一个'/'字符的
		moduleId = uri.replace(matched[0][1], matched[0][0]);
		idType = 'real_alias';
	}
	// 此模块ID 可以使用顶级标识
	if(relative.indexOf('.') !== 0){
		// 如果已经有 alias、paths ID，可以使用多个ID，则使用短的
		if(!moduleId || moduleId.length >= relative.length){
			moduleId = relative;
			idType = 'top';
		}
	}
	// 如果只能使用相对路径做标识ID，则报错
	if(!moduleId){
		console.log('\n [HELP INFO] paths and alias is parsed to: ' + JSON.stringify(conf.real_alias_rootPathed, null, 4));
		vacation.log.error('[423] module(uri:'+uri+') not in the base directory('+conf.base+'), and no paths or alias relative to its path.');
	}

	this.id = buildUtil.normalize_win_dir(moduleId);
	this.distId = this.isTpl ? (this.id + '.js') : this.id;
	this.idType = idType;
	this.type = uri.substr(uri.lastIndexOf('.') + 1).toLowerCase();
	this.inBase = relative.indexOf('.') !== 0;
	this.inSrc = pth.relative(conf.src, uri).indexOf('.')!==0;
	return this;
};

Module.prototype.dealDependency = function(){
	var conf = buildUtil.getBuildConfig();
	var moduleContent = this.originContent = buildUtil.readFile(this.uri);

	var deps = [];
	if(this.type == 'js'){
		// 删除注释和多余的空白等
		var uglifiedContent = buildUtil.getUglifiedContent(moduleContent, {
			fromString: true,
			mangle: false,
			compress: false
		}, this.uri);
		// 最标准的 CMD 模块
		if(uglifiedContent.match(/^define\(/g)){
			this.cmd = 0;
		}
		// 非 CMD 模块
		else if(!uglifiedContent.match(/\bdefine\(/g)){
			this.cmd = -1;
		}
		// 有 define(， 但是不在顶部，可能是兼容amd 或 cmd 或其他情况
		else{
			this.cmd = 1;
		}

		// 非 CMD 标准模块不能依赖其他模块，只能被其他模块所依赖
		if(this.cmd === 0){
			// => ["require("a")", "require("b")"]
			var requireMatched = uglifiedContent.match(/\brequire\((['"]).+?\1\)/g);
			if(requireMatched){
				requireMatched.forEach(function (match) {
					var useAlias;
					// => ['"b")', '"', 'b']
					var depModuleFile = match.match(/(['"])(.*)\1\)/)[2];
					var aliasedPath = buildUtil.get_real_path_by_alias(depModuleFile, conf.real_alias);
					if(depModuleFile != aliasedPath){
						useAlias = true;
					}
					depModuleFile = buildUtil.addExtraNameToFile(aliasedPath);

					// 依赖文件的
					var depModuleRelativeTo;
					// 相对路径
					if(depModuleFile.indexOf('.') == 0){
						// 相对于 conf.base 目录
						if(useAlias){
							// seajs.config 中 alias 和 paths 是相对于 base 路径的
							// 所以 vacation.js 也调整为相对于 base 路径
							depModuleRelativeTo = conf.base;
						}
						// 相对路径：相对于当前模块
						else{
							depModuleRelativeTo = pth.dirname(this.uri);
						}
					}
					// 根路径：相对于 conf.www 目录
					else if(depModuleFile.indexOf('/') == 0){
						depModuleRelativeTo = conf.www;
						if(!conf.www) vacation.log.error('[424] module('+moduleInfo.uri+') require('+depModuleFile+') but the www directory is not config.');
					}
					// 顶级标识：相对于 base 基础路几个呢
					else {
						depModuleRelativeTo = conf.base;
					}

					if(depModuleFile.indexOf('http://') == 0){
						var depModule = Module.get({uri:depModuleFile});
						deps.push(depModule);
					}
					else{
						var depModuleURI = pth.resolve(depModuleRelativeTo, depModuleFile);
						var depModule = Module.get({uri:depModuleURI});
						deps.push(depModule);
					}
				}.bind(this));
			}
		}
	}
	this.deps = deps;
	return this;
};

function deepDependency(module, alldeps){
	module.deps.forEach(function(depModule){
		depModule.alldeps.forEach(function(mod){
			if(alldeps.indexOf(mod) < 0) alldeps.push(mod);
		});
		if(alldeps.indexOf(depModule) < 0) alldeps.push(depModule);
	});
	return alldeps;
}

Module.prototype.deepDependencies = function(){
	this.alldeps = deepDependency(this, []);
	return this;
};

var REG_REQUIRE_TPL = new RegExp("\\brequire\\(\\s*('|\")(.+?\\.(?:"+TPL_TYPE.join('|')+"))\\1\\s*\\)","g");// /\brequire\(\s*('|")(.+?\.(?:html|tpl))\1\s*\)/g
var REG_SIMPLE_DEFINE = /(define\()[^\(]*(function\s*\()/g;
/*
* @param {Boolean} [optimize]
* @param {Number} [Handlebars = 0]
* */
Module.prototype.transport = function(){
	var opt = buildUtil.getOptions();
	var content = this.originContent;
	// 本来这个函数不做压缩这一步，只是模板、CSS的话，只能这里做压缩了
	if(this.isTpl){
		content = buildUtil.htmlMinify(content, {
			removeComments:opt.optimize,
			removeHandlebarsComments:opt.optimize,
			collapseWhitespace: opt.optimize
		});
		if(opt.Handlebars >= 2){
			var compiledTplFn = buildUtil.precompileHandlebars(content, this.id);
			content = 'define("'+this.distId+'",[],function(require,exports,module){'
					+ 		'var fn = Handlebar.template('+compiledTplFn+');'
					+		'fn.isPrecompiled = true;'
					+		'module.exports = fn;'
					+ '});';
		}
		else{
			content = 'define("'+this.distId+'",[],"'+buildUtil.content2StandardString(content)+'")';
		}
	}
	else if(this.type == 'css'){
		if(opt.optimize) content = buildUtil.cssMinify(this.originContent);
		content = 'seajs.importStyle("'+buildUtil.content2StandardString(content)+'");';
	}
	else if(this.type == 'js'){
		if(this.cmd == 0){
			//将模块中对 模版的依赖 改为对 transport后的模板的依赖
			content = content.replace(REG_REQUIRE_TPL, "require($1$2.js$1)");
			content = content.replace(REG_SIMPLE_DEFINE, function(match, $1, $2){
				var depsArr = this.deps;
				// 因为 seajs 对CSS模块的引入规则不同（seajs.importStyle）， 删除对CSS的依赖，因为写在依赖中就会发起额外的请求
				depsArr = depsArr.filter(function(mod){ return mod.type != 'css' });
				// 将 模版依赖 改为对 transport后模版的依赖
				depsArr = depsArr.map(function(mod){
					return mod.distId;
				});

				return $1 + '"'+this.id+'",'+JSON.stringify(depsArr)+','+$2;
			}.bind(this));
		}
	}
	this.transportedContent = content;
	return this;
};

/**
 * @param {String} uri
 * @param {Boolean} isMain
 */
Module.get = function(opt){
	canNew = true;
	var module = moduleCaches[opt.uri] || (moduleCaches[opt.uri] = new Module(opt));
	canNew = false;
	return module;
};

module.exports = Module;