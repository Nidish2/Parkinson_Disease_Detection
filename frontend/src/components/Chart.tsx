import ReactECharts from 'echarts-for-react';

const Chart = ({ option, style }: { option: any, style?: React.CSSProperties }) => {
  return (
    <ReactECharts
      option={option}
      notMerge={true}
      lazyUpdate={true}
      theme={"dark"}
      style={{ height: '100%', width: '100%', ...style }}
    />
  );
};

export default Chart;
