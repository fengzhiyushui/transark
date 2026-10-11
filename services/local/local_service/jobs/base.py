"""长任务处理器抽象（独立模块，避免 manager/handlers 循环依赖）。"""

from __future__ import annotations

from abc import ABC, abstractmethod
from typing import TYPE_CHECKING

from ..models.base import ContractModel

if TYPE_CHECKING:  # pragma: no cover - 仅用于类型标注
    from .manager import JobContext


class JobHandler(ABC):
    """长任务处理器接口。"""

    type: str = ""

    @property
    @abstractmethod
    def input_model(self) -> type[ContractModel]:
        """输入参数的 Pydantic 模型（严格校验）。"""

    @property
    @abstractmethod
    def result_model(self) -> type[ContractModel]:
        """结果数据的 Pydantic 模型。"""

    @abstractmethod
    async def execute(self, input_data: ContractModel, context: "JobContext") -> ContractModel:
        """执行任务并通过 context 上报进度。"""
