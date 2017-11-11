import { TransformFn } from "../../utils/transformAttributes/transformutils";
import { matrixof, unitMatrix } from "../../utils/svgjs/matrixutils";
import { scale } from "../../utils/coordinateutils";
import { editorRoot, svgroot, reflection, colorpickers, svgStyleAttrs, textcolor, bgcolor, refleshStyleAttribues } from "../../common";
import { svgof } from "../../utils/svgjs/svgutils";
import { Point, withDefault, reverse, equals } from "../../utils/utils";
import { Affine } from "../../utils/affineTransform/affine";
import * as SVG from "svgjs";
import * as jQuery from "jquery";
import { FixedTransformAttr, makeMatrix } from "../../utils/transformAttributes/fixdedTransformAttributes";
import { DragTarget, TargetRotate } from "./dragTargetTypes";
import { setScaleVertexes, setRotateVertex, updateScaleVertexes, updateRotateVertex } from "./setVertexes";

export type RotateVertex = { vertex: SVG.Element | undefined };

export function handMode() {

  let expandVertexesGroup = editorRoot.group().addClass("svgeditor-expandVertexes");
  let rotateVertex: RotateVertex = { vertex: undefined };

  type DragMode = "free" | "vertical" | "horizontal";

  let dragTarget: DragTarget = { kind: "none" };

  let handTarget: undefined | SVG.Element = undefined;

  svgroot.node.onmousedown = (ev) => {
    // 選択解除
    dragTarget = { kind: "none" };
    handTarget = undefined;
    expandVertexesGroup.children().forEach(elem => elem.remove());
    if (rotateVertex.vertex) rotateVertex.vertex.remove();
    rotateVertex = { vertex: undefined };
  };

  svgroot.node.onmouseup = (ev) => {
    // 変更されたHTML（のSVG部分）をエディタに反映させる
    if (dragTarget) handModeReflection(expandVertexesGroup, rotateVertex);
    // 関連する頂点を再設置
    updateScaleVertexes(dragTarget);
    updateRotateVertex(dragTarget, rotateVertex);
    dragTarget = { kind: "none" };
  };

  const moveElems: SVG.Element[] = [];

  editorRoot.each((i, elems) => {
    let elem = elems[i];
    moveElems.push(elem);
  });

  moveElems.forEach((moveElem, i) => {
    moveElem.node.onmousedown = (ev: MouseEvent) => {
      ev.stopPropagation();

      if (dragTarget.kind === "none") {
        dragTarget = {
          kind: "main",
          main: moveElem,
          vertexes: [],
          fromCursor: svgof(moveElem).getCenter().sub(Point.of(ev.clientX, ev.clientY)),
          initialScheme: {
            center: svgof(moveElem).getCenter(),
            size: svgof(moveElem).getBBoxSize(),
            fixedTransform: svgof(moveElem).getFixedTransformAttr()
          }
        };
        expandVertexesGroup.clear();
        setScaleVertexes(dragTarget, expandVertexesGroup);
        // 頂点が設定されたのでイベントを追加する
        expandVertexesGroup.children().forEach(elem => {
          let reverseVertex = expandVertexesGroup.children().find(t => equals(
            svgof(t).geta("direction")!.split(" "),
            svgof(elem).geta("direction")!.split(" ").map(dir => reverse(<any>dir))
          ))!;
          elem.node.onmousedown = (ev) => vertexMousedown(ev, moveElem, elem, expandVertexesGroup.children(), reverseVertex);
        });
        if (rotateVertex.vertex) rotateVertex.vertex.remove();
        setRotateVertex(dragTarget, rotateVertex, svgroot);
        rotateVertex.vertex!.node.onmousedown = (ev) => rotateVertexMousedown(ev, moveElem);
        // handTargetのclassがすでにあったら消す
        svgroot.select(".svgeditor-handtarget").each((i, elems) => {
          svgof(elems[i]).removeClass("svgeditor-handtarget");
        });
        handTarget = dragTarget.main;
        svgof(handTarget).addClass("svgeditor-handtarget");
        refleshStyleAttribues(moveElem);
      }
    };
  });

  svgroot.node.onmousemove = (ev: MouseEvent) => {
    ev.stopPropagation();

    if (dragTarget.kind === "main") {
      // 平行移動（図形を変更）

      // 更新後の座標
      let updatedTargetPos = dragTarget.fromCursor.add(Point.of(ev.clientX, ev.clientY));
      // 移動
      svgof(dragTarget.main).setCenter(updatedTargetPos);
      // transform
      let newFixed = Object.assign({}, dragTarget.initialScheme.fixedTransform);
      newFixed.translate = updatedTargetPos;
      svgof(dragTarget.main).setFixedTransformAttr(newFixed);
    } else if (dragTarget.kind === "vertex") {
      // 拡大

      // テキストはfont-sizeを変える
      if (dragTarget.initialScheme.fontSize) {
        let updatedPos = dragTarget.fromCursor.add(Point.of(ev.clientX, ev.clientY));
        let deltaX = updatedPos.x - dragTarget.initialVertexPos.x;
        let newFontSize = dragTarget.initialScheme.fontSize + deltaX * 0.2;
        dragTarget.main.attr("font-size", newFontSize);
      } else {
        // 頂点の移動の仕方
        let dragMode: DragMode = "free";
        let dirs = svgof(dragTarget.vertex).geta("direction")!.split(" ");
        if (dirs.length === 1) {
          if (dirs[0] === "left" || dirs[0] === "right") dragMode = "horizontal";
          else dragMode = "vertical";
        }
        // 更新後の選択中の頂点
        let updatedVertexPos = dragTarget.fromCursor.add(Point.of(ev.clientX, ev.clientY));
        // 拡大の中心点
        let scaleCenterPos = svgof(dragTarget.scaleCenter).getCenter();
        // scale
        let rotate = dragTarget.initialScheme.fixedTransform.rotate;
        let scaleRatio = scale(scaleCenterPos, dragTarget.initialVertexPos, updatedVertexPos);
        if (dragMode === "vertical") scaleRatio.x = 1;
        if (dragMode === "horizontal") scaleRatio.y = 1;
        // scaleによる図形の中心と高さ幅
        let scaledMain = dragTarget.initialScheme.center.sub(scaleCenterPos).mul(scaleRatio).add(scaleCenterPos);
        let scaledSize = dragTarget.initialScheme.size.mul(scaleRatio.abs2());
        // 更新
        dragTarget.main.center(scaledMain.x, scaledMain.y);
        dragTarget.main.size(scaledSize.x, scaledSize.y);
      }
    } else if (dragTarget.kind === "rotate") {
      // 回転

      let updatedPos = dragTarget.fromCursor.add(Point.of(ev.clientX, ev.clientY));
      let deltaX = updatedPos.x - dragTarget.initialVertexPos.x;
      // 更新
      let newFixed = Object.assign({}, dragTarget.initialScheme.fixedTransform);
      newFixed.rotate += deltaX;
      svgof(dragTarget.main).setFixedTransformAttr(newFixed);
    }
  };

  function vertexMousedown(ev: MouseEvent, main: SVG.Element, vertex: SVG.Element, vertexes: SVG.Element[], scaleCenter: SVG.Element) {
    ev.stopPropagation();

    if (dragTarget.kind === "none") {
      dragTarget = {
        kind: "vertex",
        main: main,
        vertex: vertex,
        vertexes: vertexes,
        fromCursor: svgof(vertex).getCenter().sub(Point.of(ev.clientX, ev.clientY)),
        scaleCenter: scaleCenter,
        initialVertexPos: svgof(vertex).getCenter(),
        initialScheme: {
          center: svgof(main).getCenter(),
          size: svgof(main).getBBoxSize(),
          fixedTransform: svgof(main).getFixedTransformAttr(),
          fontSize: main.node.tagName === "text" ? +withDefault(svgof(main).geta("font-size"), "12") : undefined
        }
      };
    }
  }

  function rotateVertexMousedown(ev: MouseEvent, main: SVG.Element) {
    ev.stopPropagation();

    if (dragTarget.kind === "none") {
      dragTarget = <TargetRotate>{
        kind: "rotate",
        main: main,
        vertex: rotateVertex.vertex!,
        vertexes: expandVertexesGroup.children(),
        fromCursor: svgof(rotateVertex.vertex!).getCenter().sub(Point.of(ev.clientX, ev.clientY)),
        initialVertexPos: svgof(rotateVertex.vertex!).getCenter(),
        initialScheme: {
          fixedTransform: svgof(main).getFixedTransformAttr()
        }
      };
    }
  }

  // colorpicker event
  jQuery($ => {
    $(colorpickers.fill).off("change.spectrum");
    $(colorpickers.fill).on("change.spectrum", (e, color) => {
      if (handTarget) {
        svgof(handTarget).setColorWithOpacity("fill", color, "indivisual");
        handModeReflection(expandVertexesGroup, rotateVertex);
      }
    });
    $(colorpickers.stroke).off("change.spectrum");
    $(colorpickers.stroke).on("change.spectrum", (e, color) => {
      if (handTarget) {
        svgof(handTarget).setColorWithOpacity("stroke", color, "indivisual");
        handModeReflection(expandVertexesGroup, rotateVertex);
      }
    });
  });

  svgStyleAttrs.strokewidth.oninput = e => {
    let v = withDefault<string>(svgStyleAttrs.strokewidth.value, "0");
    if (handTarget) svgof(handTarget).setStyleAttr("stroke-width", String(v), "indivisual");
    handModeReflection(expandVertexesGroup, rotateVertex);
  };
}

export function handModeReflection(expandVertexesGroup: SVG.G, rotateVertex: { vertex: SVG.Element | undefined }) {
  reflection(
    () => {
      expandVertexesGroup.remove();
      if (rotateVertex.vertex) rotateVertex.vertex.remove();
    },
    () => {
      svgroot.add(expandVertexesGroup);
      if (rotateVertex.vertex) svgroot.add(rotateVertex.vertex);
    });
}

export function handModeDestruct() {
  editorRoot.select(".svgeditor-expandVertexes").each((i, elems) => {
    elems[i].remove();
  });
  editorRoot.select("#svgeditor-vertex-rotate").each((i , elems) => {
    elems[i].remove();
  });
  editorRoot.each((i, elems) => {
    elems[i].node.onmousedown = () => undefined;
    elems[i].node.onmousemove = () => undefined;
    elems[i].node.onmouseup = () => undefined;
  });
  svgroot.node.onmouseup = () => undefined;
  svgroot.node.onmousemove = () => undefined;
}