测试文件合并打包，主包、子包，某些模块排除合并的功能

测试结果：

seajs.config 的 alias 设置 有 BUG

下面的内容见 `index.html` 文件：
```javascript
/**
 * seajs 有 BUG，这个测试project3
 *
 * 编译时，
 * 如果：①【只设置一个主包，没有子包和 except】 （这样的话，这个 lib_a 已经被打包进主包了）
 * 上面四种设置都没有问题
 * 而(5)会额外发起一个请求，并且找不到（当然找不到，因为 dest 下没有 lib_a.js）
 * -- 按理说 (1)(3)(5) 应该属于同一种情况，为何结果不同？
 *
 * 如果：②【有子包和 except，且 lib_a 被 except 了】
 * 只有(2)(4)正常，(1)(3)(5)不行，这是正确的，因为则 dest 目录下确实没有 lib_a.js
 */
```