# 北京世界：同位置前后对比

原版采用提交 `f966785` 的代码和资产，用本轮已安装工具链重建；新版采用最终本地发布包。两者使用一致WGS84相机位置和目标，加载遮罩已退场。光照、地面与渲染质量不同，截图用于比较实际场景和模型，不能作为原版性能测量。

| 景点 | 原版 | 新版 |
|---|---|---|
| 太和殿 | [原版画面](qa/compare-before-taihedian.png) | [新版画面](qa/compare-after-taihedian.png) |
| 祈年殿 | [原版画面](qa/compare-before-qiniandian.png) | [新版画面](qa/compare-after-qiniandian.png) |
| 央视总部 | [原版画面](qa/compare-before-cctv.png) | [新版画面](qa/compare-after-cctv.png) |

央视两版共用西北视角，原落位偏差保留，因此两版地标不会同时居中。另附[新版西侧清楚视角](qa/desktop-view-03-cctv.png)及[默认鸟瞰真实选择央视后的画面](qa/desktop-cctv-ui-selection.png)，避免将邻楼遮挡误当模型缺失。

太和殿对比重点是双重屋顶、柱列、台基，以及孤立地图部件去重；祈年殿是三层蓝顶、圆形柱列和三层圆台；央视是纠正尺度的倾斜环形体、连续代表性钢网。周围城市使用真实开放建筑轮廓，普通缺失高度与立面仍含明确推断。

[实际照片对照范围](landmark-visual-review.md)和[验收结果](acceptance.md)记录哪些形制、尺寸和设备测试已验证。全部雕刻、彩画、逐构件竣工复刻与独立≤3米落位没有记为通过。
