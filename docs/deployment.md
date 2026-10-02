# GitHub Pages 发布记录

2026-10-02（America/Los_Angeles）按用户指令发布上线并同步 main。

- 网站：https://clarachen07.github.io/beijing-world/
- 手机实测：https://clarachen07.github.io/beijing-world/qa.html
- 源码提交：[e38e861](https://github.com/clarachen07/beijing-world/commit/e38e861f6718fa841bb443523f33da497e51da7c)，main已同步；后续发布记录提交只改文档和证据。
- 发布分支：gh-pages，提交 [26fcbf9](https://github.com/clarachen07/beijing-world/commit/26fcbf9b9b9b423ecec70e657039d63cc5e485e3)。
- [GitHub Pages 部署](https://github.com/clarachen07/beijing-world/actions/runs/37020438796)：success。
- 发布版本：f379c023976b7b0f93a8；城市1d91e09a9c2e8b214a4d；模型d3bd20956b7d。

本次直接使用已验收的 dist，全部13,029个发布文件逐文件SHA256对齐，不在上线过程中重新生成数据、模型或网页程序。发布分支另外增加.nojekyll和deployment.json。公开release.json与deployment.json已读取核对，首屏和手机实测入口均正常启动。

## 线上复核的实际边界

本机访问公开网站的桌面回归 14/16、桌面GPU触控模拟 14/15；手机实测入口3/3。记录见[线上浏览器检查](qa/browser-online.json)。核心导航、步行、失焦、漫游尾部和WebGL恢复通过；批量加载期间出现net::ERR_FAILED，导致桌面等待分片全部结束超时及两组固定定位捕获检查失败。没有发现资源404或页面未捕获异常，不能把这次结果记为全部线上回归通过。

其中一份失败分块随后以HTTP/1.1直接取得200，SHA256与本地内容完全相同（433,977字节），支持资源确已发布；这不能证明全部失败请求的成因或所有网络条件稳定。国内公网、真实手机和长期稳定性仍需实际设备与所在地网络验收。

本地全部通过的行为/性能/故障结果仍见[本地验收报告](acceptance.md)，其范围不替代本节的公开网络结果。
